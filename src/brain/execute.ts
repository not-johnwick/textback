import type { Env } from "../env";
import { settings } from "../settings";
import { bridgeCall, sendSms } from "../twilio";
import * as db from "../db/queries";
import { aiSummary, label, notifyOwner } from "../owner/notify";
import type { Outbox } from "./tools";

/** Applies one turn's decisions. Every hard rule lives here, so a bad model turn can't break them. */
export async function execute(env: Env, customer: db.Customer, thread: db.ThreadRow, out: Outbox, startedAt: number) {
  // Notes and reminders are always kept, even if the reply gets dropped below.
  for (const f of out.facts) {
    if (f.field === "note") await db.addFact(env.DB, customer.id, f.value, "customer");
    else await db.updateCustomerField(env.DB, customer.id, f.field, f.value); // TODO: merge equipment JSON, retag on name
  }
  for (const c of out.callbacks) {
    const due = Date.parse(c.dueBy);
    await db.addReminder(env.DB, {
      customerId: customer.id, kind: "callback", reason: c.reason, priority: c.priority, createdBy: "ai",
      dueAt: Number.isNaN(due) ? Date.now() + 2 * 3_600_000 : due,
    });
  }
  if (out.visit) {
    await db.addReminder(env.DB, {
      customerId: customer.id, kind: "visit_request", reason: out.visit.summary, detail: { windows: out.visit.windows },
      dueAt: Date.now() + 30 * 60_000, createdBy: "ai", // the turn summary tells him now; nudge if still open
    });
  }
  if (out.escalation) await escalate(env, customer, out.escalation);

  // The reply: drop it if the owner texted this customer while the model was thinking.
  let sent: string | null = null;
  const ownerJumpedIn = ((await db.lastAt(env.DB, customer.id, "owner")) ?? 0) > startedAt;
  if (out.reply && !ownerJumpedIn && !customer.opted_out) {
    sent = await finalizeReply(env, customer, out.reply);
    await sendSms(env, customer.phone, sent);
    await db.insertMessage(env.DB, { customerId: customer.id, direction: "out", author: "ai", body: sent });
    await db.updateThread(env.DB, customer.id, { state: "ai_active" });
  }
  if (out.close) await db.updateThread(env.DB, customer.id, { state: "closed" });

  await notifyOwner(env, aiSummary(customer, thread.tag, sent, out));
  await db.logEvent(env.DB, "turn", customer.id, {
    sent: !!sent, close: out.close, problem: out.problem, usage: out.usage,
    first_reply_ms: sent && thread.last_inbound_at ? Date.now() - thread.last_inbound_at : null,
  });
  // TODO: when the thread closes, ask Claude for a 5-line rolling summary and store it on the customer.
}

/** Calls the owner now and connects them to the customer; also texts the reason in case the call is missed. */
export async function escalate(env: Env, customer: db.Customer, reason: string) {
  const thread = await db.getThread(env.DB, customer.id);
  await notifyOwner(env, `URGENT ${label(customer, thread?.tag ?? "")}: ${reason}`);
  await bridgeCall(env, customer.phone, `Urgent. ${customer.name ?? "A customer"}. ${reason}. Connecting you now.`);
  await db.logEvent(env.DB, "escalated", customer.id, { reason });
}

/** Guardrails on the outgoing text: GSM-7, allowed links only, 3 segments max, disclosure on first contact. */
async function finalizeReply(env: Env, customer: db.Customer, text: string): Promise<string> {
  let clean = toGsm7(text);
  clean = clean.replace(/https?:\/\/\S+/g, (url) => (settings.allowed_links.includes(url) ? url : ""));
  const lastAi = await db.lastAt(env.DB, customer.id, "ai");
  const firstContactToday = !lastAi || Date.now() - lastAi > 86_400_000;
  const signature = settings.disclose_ai && firstContactToday ? ` ${settings.ai_signature}` : "";
  const max = 459 - signature.length; // 3 GSM-7 segments of 153
  if (clean.length > max) clean = clean.slice(0, clean.lastIndexOf(" ", max - 3)) + "...";
  return clean.trim() + signature;
}

/** Keeps a text in the GSM-7 alphabet: 160 characters per segment instead of 70 with one emoji. */
export function toGsm7(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\n\r -~£¥èéùìòÇØøÅåÆæßÉÄÖÑÜ§¿äöñüà€]/g, ""); // TODO: keep non-Latin scripts when the customer writes in one
}
