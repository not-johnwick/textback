import type { Env } from "../env";
import { settings } from "../settings";
import * as db from "../db/queries";
import { whoAnswers } from "../owner/availability";
import { decide } from "./agent";
import { escalate, execute } from "./execute";
import { knowledge } from "./knowledge";

/** Runs when a Thread's alarm fires: decide whether the AI should answer, then answer. */
export async function runTurn(env: Env, customerId: number): Promise<void> {
  const startedAt = Date.now();
  const customer = await db.getCustomer(env.DB, customerId);
  const thread = await db.getThread(env.DB, customerId);
  if (!customer || !thread || customer.opted_out) return;

  // Already answered? (owner jumped in, or an earlier turn replied after the last customer text)
  const lastIn = await db.lastAt(env.DB, customerId, "customer");
  const lastOwner = await db.lastAt(env.DB, customerId, "owner");
  const lastAi = await db.lastAt(env.DB, customerId, "ai");
  if (lastIn === null) return;
  if ((lastOwner ?? 0) > lastIn || (lastAi ?? 0) > lastIn) return;
  if (thread.ai_paused_until && thread.ai_paused_until > startedAt) return; // owner took this thread over

  const who = await whoAnswers(env);
  if (!who.aiAllowed) return; // paused: the owner already has the forward

  if ((await db.aiRepliesSince(env.DB, customerId, startedAt - 3_600_000)) >= settings.max_ai_replies_per_hour) {
    return escalate(env, customer, "Long back-and-forth, please take over.");
  }

  const out = await decide(env.ANTHROPIC_API_KEY, knowledge, {
    customer,
    tag: thread.tag,
    history: await db.recentMessages(env.DB, customerId, 30),
    facts: await db.listFacts(env.DB, customerId),
    reminders: await db.openReminders(env.DB, customerId),
    learned: await db.listLearned(env.DB),
    ownerStatus: who.reason === "free" ? `free but didn't answer within ${settings.grace_minutes} min` : who.reason,
    now: new Date(startedAt),
  });

  await execute(env, customer, thread, out, startedAt);
}
