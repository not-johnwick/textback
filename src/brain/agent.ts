import Anthropic from "@anthropic-ai/sdk";
import { settings } from "../settings";
import { systemPrompt, turnMessage, type Knowledge, type TurnContext } from "./prompt";
import { makeTools, Outbox } from "./tools";

/**
 * One AI turn: Claude reads the context and calls tools; the tool runner loops until it is done.
 * Returns the Outbox; nothing has been sent yet. Pure enough to run from scripts/simulate.ts.
 */
export async function decide(apiKey: string, knowledge: Knowledge, ctx: TurnContext): Promise<Outbox> {
  const client = new Anthropic({ apiKey });
  const out = new Outbox();

  // Refusal fallback: if a safety filter declines, the API reruns the request on Anthropic's recommended model.
  // Not available for Haiku models. Needs an SDK version whose types include `fallbacks`.
  const fallback = settings.model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  // TODO v2: attach the newest customer photos as image blocks (twilio.fetchMedia) so Claude can read nameplates.
  const final = await client.beta.messages.toolRunner({
    model: settings.model,
    max_tokens: 16000,
    output_config: { effort: settings.effort as "low" | "medium" | "high" },
    system: systemPrompt(knowledge),
    tools: makeTools(out),
    messages: [{ role: "user", content: turnMessage(ctx) }],
    max_iterations: 6,
    ...fallback,
  });

  out.usage = final.usage;
  if (final.stop_reason === "refusal") out.problem = "declined by the safety filter";
  else if (!out.reply && !out.close) out.problem = "ended without replying";
  return out;
}
