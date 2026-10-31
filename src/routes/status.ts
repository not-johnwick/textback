import type { Env } from "../env";
import * as db from "../db/queries";
import { safeEqual } from "../twilio";

const MODES = ["free", "busy", "driving"] as const;

/**
 * POST /status from the owner's phone automation (shortcuts/README.md).
 * Header: Authorization: Bearer <STATUS_TOKEN>. Body (form): mode=driving|busy|free [&minutes=N].
 */
export async function handleStatus(req: Request, env: Env): Promise<Response> {
  if (!safeEqual(req.headers.get("Authorization") ?? "", `Bearer ${env.STATUS_TOKEN}`)) {
    return new Response("unauthorized", { status: 401 });
  }
  const form = new URLSearchParams(await req.text());
  const mode = form.get("mode") as (typeof MODES)[number];
  if (!MODES.includes(mode)) return new Response("mode must be free, busy or driving", { status: 400 });

  // What he set by hand (pause, off till monday) beats what his phone reports.
  const current = await db.getOwnerState(env.DB);
  if (current.mode === "paused" || (current.source === "sms" && current.mode === "off")) {
    return new Response(`ignored: owner set ${current.mode}`);
  }

  // Expire automatically in case the "off" ping never arrives (phone died, shortcut didn't run).
  const minutes = Number(form.get("minutes") ?? 0) || 180;
  const until = mode === "free" ? null : Date.now() + minutes * 60_000;
  await db.setOwnerState(env.DB, mode, until, "shortcut");
  return new Response("ok");
}
