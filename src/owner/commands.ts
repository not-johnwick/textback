import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { settings } from "../settings";
import { bridgeCall, sendSms } from "../twilio";
import * as db from "../db/queries";
import { notifyOwner } from "./notify";

type Mode = "free" | "busy" | "driving" | "off";

export type OwnerCommand =
  | { kind: "send"; tag: string; text: string }
  | { kind: "call" | "done" | "decline"; tag: string }
  | { kind: "note"; tag: string; text: string }
  | { kind: "approve"; tag: string; text: string } // text = the confirmed time, "tue 10am"
  | { kind: "snooze"; tag: string; minutes: number }
  | { kind: "remind"; tag: string; text: string; due: string } // owner's own reminder
  | { kind: "photo"; tag: string; media: string[] }
  | { kind: "status"; mode: Mode; minutes?: number }
  | { kind: "pause" | "resume" | "list" }
  | { kind: "teach"; text: string }
  | { kind: "unclear"; question: string };

/** A text from the owner's cell to the business number. Keywords first, Claude for anything else. */
export async function handleOwnerMessage(env: Env, body: string, media: string[]) {
  const tags = await db.activeTags(env.DB);
  const recent = await db.recentlyForwardedTag(env.DB, 10 * 60_000);
  const fast = parseFast(body, media, tags, recent);
  const commands = fast ? [fast] : await parseWithClaude(env, body, tags, recent);
  for (const cmd of commands) await run(env, cmd, tags);
}

export function parseFast(body: string, media: string[], tags: string[], recent: string | null): OwnerCommand | null {
  const text = body.trim();
  const lower = text.toLowerCase();

  if (/^(pause|stop bot)$/.test(lower)) return { kind: "pause" };
  if (/^(resume|start bot)$/.test(lower)) return { kind: "resume" };
  if (/^(back|free|available)$/.test(lower)) return { kind: "status", mode: "free" };
  if (/^(list|today|calls)$/.test(lower)) return { kind: "list" };

  const status = lower.match(/^(busy|driving|off)(?:\s+(\d+)\s*(h|hrs?|hours?|m|mins?|minutes?))?$/);
  if (status) {
    const n = Number(status[2] ?? 0);
    return { kind: "status", mode: status[1] as Mode, minutes: status[3]?.startsWith("h") ? n * 60 : n || undefined };
  }

  const teach = text.match(/^teach\s+([\s\S]+)$/i);
  if (teach) return { kind: "teach", text: teach[1] };

  // verb + name: call priya / note priya ... / done priya / yes priya tue 10am / no priya / snooze priya 1h
  const verb = text.match(/^(call|note|done|yes|no|snooze)\s+(\S+)\s*([\s\S]*)$/i);
  if (verb && tags.includes(verb[2].toLowerCase())) {
    const [, v, t, rest] = verb;
    const tag = t.toLowerCase();
    switch (v.toLowerCase()) {
      case "call": return { kind: "call", tag };
      case "done": return { kind: "done", tag };
      case "no": return { kind: "decline", tag };
      case "note": return { kind: "note", tag, text: rest };
      case "yes": return rest ? { kind: "approve", tag, text: rest } : { kind: "unclear", question: `What time for ${tag}? Reply: yes ${tag} tue 10am` };
      case "snooze": return { kind: "snooze", tag, minutes: parseDuration(rest) ?? 60 };
    }
  }

  // name + message: "priya be there at 3"
  const [first] = lower.split(/\s+/);
  if (tags.includes(first)) {
    const rest = text.slice(first.length).trim();
    if (media.length) return { kind: "photo", tag: first, media };
    if (rest) return { kind: "send", tag: first, text: rest };
  }
  if (media.length && recent) return { kind: "photo", tag: recent, media };
  return null;
}

const COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commands"],
  properties: {
    commands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "tag", "text", "minutes", "mode", "due"],
        properties: {
          kind: {
            type: "string",
            enum: ["send", "call", "note", "approve", "decline", "done", "snooze", "remind", "status", "pause", "resume", "list", "teach", "unclear"],
          },
          tag: { type: ["string", "null"] },
          text: { type: ["string", "null"], description: "message to send, note, time, fact, or for unclear: the question to ask the owner" },
          minutes: { type: ["integer", "null"] },
          mode: { type: ["string", "null"], enum: ["free", "busy", "driving", "off", null] },
          due: { type: ["string", "null"], description: "ISO 8601 with UTC offset, for remind" },
        },
      },
    },
  },
} as const;

/** "tell priya I'll be there at 3 and remind me to bring a 40/5 capacitor" -> send + remind. */
async function parseWithClaude(env: Env, body: string, tags: string[], recent: string | null): Promise<OwnerCommand[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const now = new Date().toLocaleString("en-CA", { timeZone: settings.timezone, dateStyle: "full", timeStyle: "short" });
  const res = await client.messages.create({
    model: settings.model,
    max_tokens: 2048,
    output_config: { effort: "low", format: { type: "json_schema", schema: COMMAND_SCHEMA } },
    system:
      `Turn the business owner's text into commands for their SMS assistant. Now: ${now} (${settings.timezone}). ` +
      `Customer names (tags) in play: ${tags.join(", ") || "none"}. Most recently forwarded: ${recent ?? "none"}. ` +
      `A message with no name that reads like a reply to a customer goes to the most recently forwarded one; ` +
      `if there is none or it is ambiguous, return one "unclear" command whose text asks who it is for.`,
    messages: [{ role: "user", content: body }],
  });
  const block = res.content.find((b) => b.type === "text");
  if (res.stop_reason === "refusal" || !block || block.type !== "text") {
    return [{ kind: "unclear", question: "Didn't get that. Try: <name> <text>, call <name>, list" }];
  }
  // TODO: map the flat schema rows onto OwnerCommand (validate tag is in `tags`, drop rows missing fields).
  const parsed = JSON.parse(block.text) as { commands: Record<string, unknown>[] };
  return parsed.commands as unknown as OwnerCommand[];
}

async function run(env: Env, cmd: OwnerCommand, tags: string[]): Promise<void> {
  if ("tag" in cmd && cmd.tag && !tags.includes(cmd.tag)) {
    return notifyOwner(env, `No one called ${cmd.tag}. Active: ${tags.slice(0, 8).join(", ")}`);
  }
  const customer = "tag" in cmd ? await db.findByTag(env.DB, cmd.tag) : null;

  switch (cmd.kind) {
    case "send": {
      await sendSms(env, customer!.phone, cmd.text);
      await db.insertMessage(env.DB, { customerId: customer!.id, direction: "out", author: "owner", body: cmd.text });
      await db.updateThread(env.DB, customer!.id, {
        state: "owner_active",
        ai_paused_until: Date.now() + settings.owner_takeover_hours * 3_600_000,
      });
      await env.THREAD.get(env.THREAD.idFromName(customer!.phone)).ownerReplied();
      return notifyOwner(env, `Sent to ${cmd.tag}.`);
    }
    case "call":
      // TODO: whisper the newest open reminder's reason instead of a generic line.
      await bridgeCall(env, customer!.phone, `Calling ${customer!.name ?? cmd.tag}.`);
      return;
    case "note":
      await db.addFact(env.DB, customer!.id, cmd.text, "owner");
      return notifyOwner(env, `Saved to ${cmd.tag}.`);
    case "status": {
      const until = cmd.minutes ? Date.now() + cmd.minutes * 60_000 : null;
      await db.setOwnerState(env.DB, cmd.mode, until, "sms");
      return notifyOwner(env, cmd.mode === "free" ? "Back to you. I'll still cover anything you miss for 3 min." : `OK, I'm answering${until ? " until " + clock(until) : ""}.`);
    }
    case "pause":
      await db.setOwnerState(env.DB, "paused", null, "sms");
      return notifyOwner(env, "Paused. I won't text any customer until you send 'resume'.");
    case "resume":
      await db.setOwnerState(env.DB, "free", null, "sms");
      return notifyOwner(env, "Back on.");
    case "teach":
      await db.addLearned(env.DB, cmd.text);
      return notifyOwner(env, "Got it, using that from now on.");
    case "unclear":
      return notifyOwner(env, cmd.question);
    case "list":
    case "approve":
    case "decline":
    case "done":
    case "snooze":
    case "remind":
    case "photo":
      // TODO:
      // list    -> openReminders(), one line each: "4:30 call priya (furnace banging)"
      // approve -> close the visit_request, text the customer "{owner} confirmed: <time>", log it
      // decline -> close it, text "{owner} can't make those times, will call you to find another", add a callback
      // done    -> close open reminders for the customer; v2: schedule a review request for tomorrow 10 am
      // snooze  -> move due_at forward, status snoozed
      // remind  -> addReminder(createdBy owner)
      // photo   -> addFact(source photo); v2: Claude reads the nameplate into equipment
      return notifyOwner(env, `(${cmd.kind} isn't built yet)`);
  }
}

function parseDuration(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d+)\s*(h|hrs?|hours?|m|mins?|minutes?)$/);
  return m ? Number(m[1]) * (m[2].startsWith("h") ? 60 : 1) : null;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-CA", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit" });
}
