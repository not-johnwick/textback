import type { Env } from "../env";
import { inBusinessHours } from "../settings";
import * as db from "../db/queries";

export type Who = {
  ownerFirst: boolean; // forward to the owner and give them the grace window
  aiAllowed: boolean; // the AI may answer at all
  reason: string; // shown to the AI as "Owner status"
};

/** Layered, first match wins: manual or phone status, then calendar (v2), then business hours. */
export async function whoAnswers(env: Env): Promise<Who> {
  const state = await db.getOwnerState(env.DB);
  const active = state.until === null || state.until > Date.now();

  if (state.mode === "paused") return { ownerFirst: true, aiAllowed: false, reason: "paused" };
  if (active && state.mode !== "free") return { ownerFirst: false, aiAllowed: true, reason: state.mode };

  // TODO v2: busy blocks from the owner's Google Calendar secret iCal URL, cached by the cron tick.

  if (!inBusinessHours()) return { ownerFirst: false, aiAllowed: true, reason: "after_hours" };
  return { ownerFirst: true, aiAllowed: true, reason: "free" };
}
