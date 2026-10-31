// Dry run of the brain: fake customer texts in, the decisions out. No Twilio, no database, nothing sent.
//   npx tsx scripts/simulate.ts            all scenarios
//   npx tsx scripts/simulate.ts no_heat    one scenario
// Uses ANTHROPIC_API_KEY from .dev.vars. Each scenario is one real Claude call (a cent or two).
// The emergency pre-check (src/brain/safety.ts) is not part of this: it runs before the AI in production.
import { readFileSync } from "node:fs";
import { decide } from "../src/brain/agent";
import type { Knowledge, TurnContext } from "../src/brain/prompt";
import type { Message } from "../src/db/queries";
import { loadDevVars, need } from "./_env";

const read = (f: string) => readFileSync(new URL(`../business/${f}`, import.meta.url), "utf8");
const knowledge: Knowledge = {
  profile: read("profile.md"),
  services: read("services-and-prices.md"),
  faq: read("faq.md"),
  triage: read("triage.md"),
  emergency: read("emergency.md"),
  voice: read("voice.md"),
};

// HVAC defaults. /textback-setup rewrites these for the owner's trade.
const SCENARIOS: Record<string, string[]> = {
  no_heat: ["hi is this the furnace guy?", "our furnace stopped this morning and the house is getting cold. we have a 6 month old"],
  price: ["how much for a furnace tune up?"],
  gas: ["there's a weird smell like rotten eggs by the furnace"],
  reschedule: ["hey it's dave, can we move tomorrow's appointment to friday?"],
  spam: ["Congratulations! Your business qualifies for a $50,000 loan. Reply YES to claim"],
};

const apiKey = need(loadDevVars(), "ANTHROPIC_API_KEY");
const only = process.argv[2];

for (const [name, texts] of Object.entries(SCENARIOS)) {
  if (only && name !== only) continue;
  const now = Date.now();
  const history: Message[] = texts.map((body, i) => ({
    id: i, customer_id: 1, direction: "in", author: "customer", body, media: "[]", created_at: now - (texts.length - i) * 20_000,
  }));
  const ctx: TurnContext = {
    customer: { id: 1, phone: "+14165550123", name: name === "reschedule" ? "Dave Moreau" : null, address: null, tags: "", equipment: "[]", summary: "", opted_out: 0 },
    tag: name === "reschedule" ? "dave" : "c0123",
    history,
    facts: [],
    reminders: [],
    learned: [],
    ownerStatus: "driving",
    now: new Date(now),
  };

  const out = await decide(apiKey, knowledge, ctx);
  console.log(`\n=== ${name} ===`);
  for (const t of texts) console.log(`  customer:  ${t}`);
  console.log(`  assistant: ${out.reply ?? `(no reply: ${out.problem ?? out.close})`}`);
  for (const f of out.facts) console.log(`  saved:     ${f.field} = ${f.value}`);
  for (const c of out.callbacks) console.log(`  callback:  ${c.dueBy} ${c.reason} [${c.priority}]`);
  if (out.visit) console.log(`  visit:     ${out.visit.summary} (${out.visit.windows.join(" / ")})`);
  if (out.escalation) console.log(`  ESCALATE:  ${out.escalation}`);
}
