import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * What the model decided this turn. Tools only fill this in; src/brain/execute.ts applies it with the guardrails.
 * The model can't text anyone, call anyone or write to the database directly.
 */
export class Outbox {
  reply: string | null = null;
  facts: { field: "name" | "address" | "equipment" | "note"; value: string }[] = [];
  callbacks: { reason: string; dueBy: string; priority: "normal" | "high" }[] = [];
  visit: { summary: string; windows: string[] } | null = null;
  escalation: string | null = null;
  close: string | null = null;
  problem: string | null = null; // why the turn ended without a reply, for the owner
  usage: unknown = null;
}

export function makeTools(out: Outbox) {
  return [
    betaZodTool({
      name: "send_reply",
      description:
        "Queue the one text message to send the customer this turn. Plain text, under 300 characters, no emoji. " +
        "This is the only way anything reaches the customer.",
      inputSchema: z.object({ text: z.string().min(1).max(480) }),
      run: async ({ text }) => {
        if (out.reply) return "A reply is already queued; only one text per turn.";
        out.reply = text;
        return "Queued.";
      },
    }),
    betaZodTool({
      name: "save_customer_fact",
      description:
        "Save something useful the customer told you (or a photo showed) to their card: name, address, equipment " +
        "(brand, model, age), or a note (tenant/owner, landlord, best time to call, pets, access).",
      inputSchema: z.object({
        field: z.enum(["name", "address", "equipment", "note"]),
        value: z.string().min(1),
      }),
      run: async (fact) => {
        out.facts.push(fact);
        return "Saved.";
      },
    }),
    betaZodTool({
      name: "create_callback",
      description:
        "Remind the owner to call this customer back by a time. Use the same time you promise the customer. " +
        "due_by is ISO 8601 with the UTC offset, e.g. 2026-10-30T16:30:00-04:00.",
      inputSchema: z.object({
        reason: z.string().describe("one line the owner reads before calling, e.g. 'furnace bangs on startup, no gas smell'"),
        due_by: z.string(),
        priority: z.enum(["normal", "high"]),
      }),
      run: async ({ reason, due_by, priority }) => {
        out.callbacks.push({ reason, dueBy: due_by, priority });
        return "Callback reminder queued.";
      },
    }),
    betaZodTool({
      name: "request_visit",
      description:
        "Ask the owner to approve a visit. List the windows the customer said work. The owner confirms the time; " +
        "tell the customer it is requested, not booked.",
      inputSchema: z.object({
        job_summary: z.string(),
        windows: z.array(z.string()).min(1).max(4).describe("e.g. 'Tue morning', 'Wed after 3 pm'"),
      }),
      run: async ({ job_summary, windows }) => {
        out.visit = { summary: job_summary, windows };
        return "Visit request queued for the owner.";
      },
    }),
    betaZodTool({
      name: "escalate_now",
      description:
        "Phone the owner right now and connect them to this customer. For emergencies, vulnerable people without " +
        "heat, angry customers, damage or legal trouble, or a second request for a person.",
      inputSchema: z.object({ reason: z.string().describe("one line read aloud to the owner before connecting") }),
      run: async ({ reason }) => {
        out.escalation = reason;
        return "The owner will be called now.";
      },
    }),
    betaZodTool({
      name: "close_thread",
      description: "End the conversation without a reply: resolved (a thanks or ok), spam, wrong number, sales pitch.",
      inputSchema: z.object({ reason: z.enum(["resolved", "spam", "wrong_number", "sales_pitch", "not_a_customer"]) }),
      run: async ({ reason }) => {
        out.close = reason;
        return "Closed.";
      },
    }),
  ];
}
