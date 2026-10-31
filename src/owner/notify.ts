import type { Env } from "../env";
import { settings } from "../settings";
import { sendSms } from "../twilio";
import * as db from "../db/queries";
import type { Outbox } from "../brain/tools";

// Everything the owner reads. Plain text, short lines, the command to type at the end.

export function label(c: db.Customer, tag: string): string {
  return `${tag} (${c.name ?? c.phone})`;
}

export async function notifyOwner(env: Env, text: string) {
  await sendSms(env, settings.owner_cell, text);
  await db.logEvent(env.DB, "owner_notified", null, { text });
}

export async function forwardToOwner(env: Env, c: db.Customer, tag: string, body: string, media: string[]) {
  const photos = media.length ? ` [${media.length} photo]` : "";
  // TODO: forward the photos too (MMS) once media URLs are fetched with auth and re-hosted.
  await notifyOwner(
    env,
    `${label(c, tag)}: "${body}"${photos}\n` +
      `Reply: ${tag} <text> | call ${tag}. I'll answer in ${settings.grace_minutes} min if you don't.`,
  );
}

export function aiSummary(c: db.Customer, tag: string, sent: string | null, out: Outbox): string {
  const lines = [sent ? `Answered ${label(c, tag)}: "${sent}"` : `Didn't answer ${label(c, tag)}: ${out.problem ?? out.close ?? "you already replied"}`];
  for (const cb of out.callbacks) lines.push(`Callback by ${shortTime(cb.dueBy)}: ${cb.reason}`);
  if (out.visit) lines.push(`Wants a visit: ${out.visit.windows.join(" / ")}. Reply: yes ${tag} <time>`);
  for (const f of out.facts) lines.push(`Saved: ${f.value}`);
  lines.push(`Reply: ${tag} <text> | call ${tag}`);
  return lines.join("\n");
}

function shortTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleTimeString("en-CA", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit" });
}
