import type { Env } from "./env";
import { handleSms } from "./routes/sms";
import { handleVoice, handleVoiceAfter, handleVoiceNote } from "./routes/voice";
import { handleStatus } from "./routes/status";
import { tick } from "./jobs/tick";

export { Thread } from "./thread";

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === "POST") {
      switch (pathname) {
        case "/twilio/sms":
          return handleSms(req, env, ctx);
        case "/twilio/voice":
          return handleVoice(req, env);
        case "/twilio/voice/after":
          return handleVoiceAfter(req, env, ctx);
        case "/twilio/voice/note":
          return handleVoiceNote(req, env, ctx);
        case "/status":
          return handleStatus(req, env);
      }
    }
    if (pathname === "/health") return new Response("ok");
    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;
