import type { Env } from "../env";
import { fill, settings } from "../settings";
import { sendSms, twiml, verifyTwilio } from "../twilio";
import * as db from "../db/queries";
import { notifyOwner, label } from "../owner/notify";

/** POST /twilio/voice. Customer calls ring the owner; the owner calling in leaves a voice note (v2). */
export async function handleVoice(req: Request, env: Env): Promise<Response> {
  const form = await verifyTwilio(req, env);
  if (!form) return new Response("forbidden", { status: 403 });

  if (form.get("From") === settings.owner_cell) {
    return twiml(
      `<Say>Leave your note after the beep. Start with the customer's name.</Say>` +
        `<Record maxLength="120" playBeep="true" action="/twilio/voice/note"/>`,
    );
  }

  // TODO voicemail trap: if the owner's cell voicemail picks up, Twilio reports "completed" and no missed-call
  // text goes out. Fix with <Number url="/twilio/voice/screen"> that says "Business call, press 1" and hangs up
  // the owner leg when no key is pressed.
  return twiml(
    `<Dial timeout="20" action="/twilio/voice/after"><Number>${settings.owner_cell}</Number></Dial>`,
  );
}

/** POST /twilio/voice/after. Twilio reports how the forwarded call went. */
export async function handleVoiceAfter(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await verifyTwilio(req, env);
  if (!form) return new Response("forbidden", { status: 403 });

  if (form.get("DialCallStatus") === "completed") return twiml("<Hangup/>");
  ctx.waitUntil(missedCall(env, form.get("From") ?? ""));
  return twiml(`<Say>Sorry we missed you. We'll text you right now.</Say><Hangup/>`);
}

async function missedCall(env: Env, from: string) {
  const customer = await db.upsertCustomer(env.DB, from);
  const thread = await db.ensureThread(env.DB, customer);
  if (customer.opted_out) return;

  // TODO: landlines can't receive texts (Twilio error 30006). Check with Twilio Lookup line type first,
  // or catch the failure and tell the owner to call back instead.
  const text = fill(settings.missed_call_text);
  await sendSms(env, from, text);
  await db.insertMessage(env.DB, { customerId: customer.id, direction: "out", author: "system", body: text });
  await db.logEvent(env.DB, "missed_call", customer.id);
  await notifyOwner(env, `Missed call from ${label(customer, thread.tag)}. Texted them. Reply: call ${thread.tag}`);
  // Their reply comes in through /twilio/sms like any other text.
}

/** POST /twilio/voice/note (v2). Owner's voice note: transcribe, file facts and reminders, confirm by text. */
export async function handleVoiceNote(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await verifyTwilio(req, env);
  if (!form) return new Response("forbidden", { status: 403 });
  // TODO v2:
  // 1. Fetch form.get("RecordingUrl") + ".wav" with Twilio auth.
  // 2. Transcribe with Workers AI Whisper: env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio }).
  // 3. Ask Claude (structured output) for { tag or name, facts[], reminders[] }, matching against activeTags().
  // 4. Save, then notifyOwner(env, "Filed for priya: replaced igniter; reminder set for April").
  return twiml(`<Say>Got it.</Say><Hangup/>`);
}
