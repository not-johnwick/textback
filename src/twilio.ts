import type { Env } from "./env";
import { settings } from "./settings";

const API = "https://api.twilio.com/2010-04-01/Accounts";
const enc = new TextEncoder();

/**
 * Checks X-Twilio-Signature and returns the form fields, or null if the request isn't from Twilio.
 * Signature = base64(HMAC-SHA1(auth token, full URL + each POST field name and value, sorted by name)).
 */
export async function verifyTwilio(req: Request, env: Env): Promise<URLSearchParams | null> {
  const form = new URLSearchParams(await req.text());
  const { pathname, search } = new URL(req.url);
  let data = env.PUBLIC_URL + pathname + search;
  for (const name of [...new Set(form.keys())].sort()) {
    for (const value of form.getAll(name)) data += name + value;
  }
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(env.TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  return safeEqual(expected, req.headers.get("X-Twilio-Signature") ?? "") ? form : null;
}

/** Constant-time string compare (Workers' crypto.subtle.timingSafeEqual needs equal lengths). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

/** Media URLs attached to an inbound MMS (MediaUrl0..N). */
export function mediaUrls(form: URLSearchParams): string[] {
  const count = Number(form.get("NumMedia") ?? 0);
  return Array.from({ length: count }, (_, i) => form.get(`MediaUrl${i}`)).filter((u): u is string => !!u);
}

/** Sends an SMS (or MMS with mediaUrl) from the business number. Returns the Twilio message SID. */
export async function sendSms(env: Env, to: string, body: string, mediaUrl: string[] = []): Promise<string> {
  const params = new URLSearchParams({ To: to, From: settings.business_number, Body: body });
  for (const url of mediaUrl) params.append("MediaUrl", url);
  const res = await twilioPost(env, "Messages.json", params);
  return res.sid;
}

/**
 * Bridged call: rings the owner, reads a one-line whisper, then dials the customer from the business number.
 * Used by `call <name>` and by escalate_now. The owner's cell is never shown to the customer.
 */
export async function bridgeCall(env: Env, customerPhone: string, whisper: string): Promise<string> {
  const twiml =
    `<Response><Say>${xml(whisper)}</Say>` +
    `<Dial callerId="${settings.business_number}"><Number>${customerPhone}</Number></Dial></Response>`;
  const params = new URLSearchParams({ To: settings.owner_cell, From: settings.business_number, Twiml: twiml });
  const res = await twilioPost(env, "Calls.json", params);
  return res.sid;
}

/** Fetches Twilio-hosted media (MMS photos) with account auth, for passing to Claude as an image. */
export async function fetchMedia(env: Env, url: string): Promise<{ mediaType: string; base64: string }> {
  // TODO: GET with the same Basic auth header, follow the redirect, base64 the body, read content-type.
  throw new Error("not implemented");
}

export function twiml(inner = ""): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export function xml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function twilioPost(env: Env, path: string, params: URLSearchParams): Promise<{ sid: string }> {
  const res = await fetch(`${API}/${env.TWILIO_ACCOUNT_SID}/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) throw new Error(`Twilio ${path} failed ${res.status}: ${await res.text()}`);
  return res.json();
}
