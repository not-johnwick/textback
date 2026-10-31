import emergencyGuide from "../../business/emergency.md";
import { fill } from "../settings";

// Deterministic checks that run before any AI. English keywords only: the AI catches the rest and can
// still call escalate_now. Add the languages his customers text in.

export type Emergency = "gas" | "co" | "electrical";

export type Check =
  | { kind: "ok" }
  | { kind: "opt_out" }
  | { kind: "opt_in" }
  | { kind: "ignore"; why: string }
  | { kind: "emergency"; type: Emergency };

const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i; // Twilio enforces these too
const OPT_IN = /^\s*(start|unstop)\s*$/i;
const AUTO_REPLY = /(auto[- ]?reply|this is an automated|driving with do not disturb|i'?m driving.*(get back|notified))/i;

const EMERGENCY: [Emergency, RegExp][] = [
  ["gas", /\b(smell(s|ing)?( of| like)? gas|gas (smell|leak)|smells? like (rotten )?eggs?)\b/i],
  ["co", /\b(carbon monoxide|co (alarm|detector))\b/i],
  ["electrical", /\b(sparks?|sparking|burning smell|smells? (like )?burning|smoke)\b/i],
];

export function precheck(body: string): Check {
  if (OPT_OUT.test(body)) return { kind: "opt_out" };
  if (OPT_IN.test(body)) return { kind: "opt_in" };
  if (AUTO_REPLY.test(body)) return { kind: "ignore", why: "auto-reply" }; // never argue with another bot
  for (const [type, pattern] of EMERGENCY) if (pattern.test(body)) return { kind: "emergency", type };
  return { kind: "ok" };
}

/**
 * The fixed safety text for an emergency, read from business/emergency.md so the owner's file is the only source:
 * the first quoted paragraph under the matching "## " heading.
 */
export function emergencyReply(type: Emergency): string {
  const heading = { gas: "## Gas smell", co: "## CO alarm", electrical: "## Water near electrics" }[type];
  const section = emergencyGuide.split(heading)[1]?.split("\n## ")[0] ?? "";
  const quoted = section.match(/"([\s\S]+?)"/)?.[1];
  if (!quoted) throw new Error(`business/emergency.md has no quoted reply under "${heading}"`);
  return fill(quoted.replace(/\s*\n\s*/g, " "));
}
