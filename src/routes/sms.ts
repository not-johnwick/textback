import type { Env } from "../env";
import { settings } from "../settings";
import { verifyTwilio, mediaUrls, sendSms, twiml } from "../twilio";
import * as db from "../db/queries";
import { precheck, emergencyReply } from "../brain/safety";
import { escalate } from "../brain/execute";
import { whoAnswers } from "../owner/availability";
import { handleOwnerMessage } from "../owner/commands";
import { forwardToOwner } from "../owner/notify";

/** POST /twilio/sms. Answers Twilio at once; replies go out later through the REST API. */
export async function handleSms(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await verifyTwilio(req, env);
  if (!form) return new Response("forbidden", { status: 403 });

  const from = form.get("From") ?? "";
  const body = form.get("Body") ?? "";
  const sid = form.get("MessageSid") ?? "";
  const media = mediaUrls(form);

  if (from === settings.owner_cell) ctx.waitUntil(handleOwnerMessage(env, body, media));
  else ctx.waitUntil(onCustomerText(env, from, body, media, sid));
  return twiml();
}

async function onCustomerText(env: Env, from: string, body: string, media: string[], sid: string) {
  const customer = await db.upsertCustomer(env.DB, from);
  const fresh = await db.insertMessage(env.DB, {
    customerId: customer.id, direction: "in", author: "customer", body, media, twilioSid: sid,
  });
  if (!fresh) return; // Twilio retry of a text we already have
  const thread = await db.ensureThread(env.DB, customer);
  await db.updateThread(env.DB, customer.id, { last_inbound_at: Date.now() });

  const check = precheck(body);
  if (check.kind === "opt_out") return db.setOptedOut(env.DB, customer.id, true);
  if (check.kind === "opt_in") return db.setOptedOut(env.DB, customer.id, false);
  if (customer.opted_out || check.kind === "ignore") return;

  if (check.kind === "emergency") {
    // Fixed safety text first, no AI in the way. The AI still runs below for the follow-up.
    const text = emergencyReply(check.type);
    await sendSms(env, from, text);
    await db.insertMessage(env.DB, { customerId: customer.id, direction: "out", author: "system", body: text });
    await escalate(env, customer, `${check.type.toUpperCase()}: "${body}"`);
  }

  const who = await whoAnswers(env);
  if (who.ownerFirst) {
    await forwardToOwner(env, customer, thread.tag, body, media);
    await db.updateThread(env.DB, customer.id, {
      state: "waiting_owner",
      last_forwarded_at: Date.now(),
      owner_grace_until: Date.now() + settings.grace_minutes * 60_000,
    });
  }

  // Owner free: give him the grace window. Owner busy: just wait out the burst.
  const delayMs = who.ownerFirst ? settings.grace_minutes * 60_000 : settings.debounce_seconds * 1000;
  await env.THREAD.get(env.THREAD.idFromName(from)).inbound(customer.id, delayMs);
}
