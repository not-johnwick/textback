---
name: textback-manage
description: Day-to-day admin for an installed TextBack SMS assistant, in plain English. Edit what the assistant knows (prices, FAQ, hours, voice), look up customers and conversations, review callbacks, pause or resume the assistant, import customers, check costs and logs, redeploy. Use when the user types /textback-manage or asks to change, check or fix their TextBack assistant.
---

# TextBack manage

The owner talks; you do the technical part. Confirm what you changed in one or two lines.

## What lives where
- What the assistant knows: `business/*.md` and `business/settings.json`. Changes need `npx wrangler deploy`.
- Live data: the D1 database `textback`. Query with
  `npx wrangler d1 execute textback --remote --command "<SQL>"`. Schema in `src/db/schema.sql`.
- Facts taught by text (`teach ...`) are in the `knowledge_learned` table. Fold them into `business/faq.md` when they
  pile up, then delete the folded rows (ask first).

## Common requests
| They say | You do |
|---|---|
| "add / change a price", "we don't do X anymore", "new hours" | edit the right `business/` file, show the diff, deploy |
| "sound more like me", "too formal" | edit `business/voice.md`; run `npx tsx scripts/simulate.ts` on 2 sample texts to show the change |
| "what did it say to Dave?" | find the customer by name, print the thread from `messages` like a phone screen |
| "who do I need to call?" | open `reminders` ordered by due time, with the reason |
| "add a customer", "Raj is Priya's landlord" | insert into `customers` / `facts` |
| "import my customers" | `npx tsx scripts/import-customers.ts <file>` |
| "pause it" / "turn it back on" | set `owner_state.mode` to `paused` / `free` (same as texting `pause` / `resume`) |
| "how's it doing?" | last 7 days from `events`: texts, median first reply, AI vs owner, callbacks, visits |
| "is it broken?" | `curl <PUBLIC_URL>/health`, `npx wrangler tail` while they send a test text, Twilio message logs |
| "what's it costing?" | Twilio usage API for this month, plus the Claude spend estimated from `events` token counts |

## Rules
- Never print `.dev.vars` or any secret. Rotate a secret with `npx wrangler secret put NAME`.
- Before deleting customer data, say exactly what will go and get a yes.
- Changes to `src/brain/prompt.ts` or `src/brain/execute.ts` change safety behaviour: explain the change in one line
  and get a yes before deploying.
