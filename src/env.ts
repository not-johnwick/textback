import type { Thread } from "./thread";

export interface Env {
  DB: D1Database;
  THREAD: DurableObjectNamespace<Thread>;
  AI: Ai; // v2: voice-note transcription

  // [vars] in wrangler.toml
  PUBLIC_URL: string;

  // secrets: `npx wrangler secret put NAME`
  ANTHROPIC_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  STATUS_TOKEN: string; // shared secret for the phone-automation status pings
}
