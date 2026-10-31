import type { Env } from "../env";
import { settings } from "../settings";
import * as db from "../db/queries";
import { notifyOwner } from "../owner/notify";

/** Cron, every minute: nudge due reminders, expire temporary statuses, send the digest and weekly report. */
export async function tick(env: Env): Promise<void> {
  const now = Date.now();
  await nudgeDueReminders(env, now);
  await expireOwnerStatus(env, now);
  if (isLocalTime(settings.digest_time, now)) await sendDigest(env);
  if (isWeeklyTime(now)) await sendWeeklyReport(env);
}

async function nudgeDueReminders(env: Env, now: number) {
  for (const r of await db.dueReminders(env.DB, now)) {
    const line =
      r.kind === "visit_request"
        ? `${r.tag} wants a visit (${r.reason}): ${JSON.parse(r.detail).windows?.join(" / ")}. Reply: yes ${r.tag} <time> | no ${r.tag}`
        : `Call ${r.tag}: ${r.reason}. Reply: call ${r.tag} | snooze ${r.tag} 1h | done ${r.tag}`;
    await notifyOwner(env, r.nudged_at ? `Still open. ${line}` : line);
    await db.updateReminder(env.DB, r.id, { nudged_at: now });
  }
}

async function expireOwnerStatus(env: Env, now: number) {
  const state = await db.getOwnerState(env.DB);
  if (state.mode !== "free" && state.mode !== "paused" && state.until !== null && state.until <= now) {
    await db.setOwnerState(env.DB, "free", null, state.source);
    await notifyOwner(env, `Your "${state.mode}" status ended. Texts come to you first again.`);
  }
}

async function sendDigest(env: Env) {
  // TODO: today's callbacks and visit requests (openReminders), overdue ones first, plus last night's AI replies.
  // Skip if an events row 'digest_sent' exists for today (a missed tick must not double-send).
}

async function sendWeeklyReport(env: Env) {
  // TODO from events + messages, last 7 days:
  // texts received; median first reply (AI turns: first_reply_ms; owner: first owner message after an inbound);
  // answered by AI vs owner; callbacks done / overdue; visits requested / approved;
  // turns with a `problem` ("questions I couldn't answer: reply 'teach' to fill them in").
}

function isLocalTime(hhmm: string, now: number): boolean {
  const local = new Date(now).toLocaleTimeString("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit" });
  return local === hhmm;
}

function isWeeklyTime(now: number): boolean {
  const day = new Date(now).toLocaleDateString("en-US", { timeZone: settings.timezone, weekday: "short" }).toLowerCase();
  return day === settings.weekly_report.day && isLocalTime(settings.weekly_report.time, now);
}
