---
name: textback-setup
description: Install TextBack, the SMS assistant for contractors, end to end. Interviews the owner about the business, sets up the Twilio number and carrier registration, deploys the Cloudflare Worker, and tests it live. Use when the user types /textback-setup or asks to install, set up or deploy TextBack.
---

# TextBack setup

You are installing an SMS assistant for a busy tradesperson. They are probably not technical. Talk like a helpful
friend: plain words, one question at a time, never a wall of options. Do the technical work yourself.

Read `BLUEPRINT.md` once before starting. Keep a checklist in `setup-progress.md` in this folder so a half-finished
setup can resume: at the start, if it exists, read it and continue from the first unchecked step.

## Hard rules
- Never ask the owner to paste an API key, auth token or password into the chat. Secrets go in with
  `npx wrangler secret put NAME` (they type it in the terminal prompt) and into `.dev.vars` for local runs, which you
  create from `.dev.vars.example` and they fill in themselves in their editor.
- Never print `.dev.vars`. To check which secrets exist: `cut -d= -f1 .dev.vars`.
- Don't buy a number or start a paid registration without saying the price and getting a yes.
- If a step fails, read the error, fix the cause, and say in one line what happened. Don't loop on the same command.

## Step 1. Which number will customers text?
Ask: "Do customers text you today on your cell, or on a business landline / office number?"
- Cell, or no business number yet: path **A**, a new local number (about $1-2/month). Ask which area code.
- Landline or VoIP office number they want to keep: path **B**, Twilio Hosted SMS (texts move to Twilio, calls stay;
  needs a signed letter of authorisation; about 1 business day). Mobile numbers can't use this.
- They insist on moving their cell number: path **C**, porting (1-3 weeks). Set up with a path A number now and swap
  later.
Explain in one sentence that texts sent to their personal cell can't be read by any software, so the business number
has to be the one on the truck, website and Google profile.

## Step 2. Accounts
Walk them through each, one at a time, and wait for "done":
1. Twilio: sign up, then **upgrade** the account (trial accounts only text verified numbers and add a trial banner).
2. Anthropic: create an API key at console.anthropic.com, add a few dollars of credit.
3. Cloudflare: free account, then the Workers Paid plan ($5/month; the free plan's CPU limit is too tight).
   Then run `npx wrangler login` for them; it opens the browser.
Then create `.dev.vars` from `.dev.vars.example` and ask them to fill it in their editor.

## Step 3. Number and carrier registration (start early, it takes days)
- Path A: `npx tsx scripts/twilio-setup.ts search --area <code>`; show 3 numbers; on their pick and a yes to the price,
  `npx tsx scripts/twilio-setup.ts buy --number <E.164>`.
- Path B: open Twilio's Hosted SMS flow for them and explain the authorisation letter.
- Registration: decide by country.
  - US number: A2P 10DLC. No EIN: sole-proprietor brand. With EIN: low-volume standard brand. Look up the current
    fees on Twilio's pricing page and quote them before starting. Use campaign type "Customer Care", with sample
    messages taken from the dry run in step 5 (come back and fill them then if needed).
  - Canadian number: check Twilio's current Canadian requirements (numbers bought since March 2025, and any texting to
    US phones, need registration). Don't rely on memory; read the live page.
- Record the registration status in `setup-progress.md`. Everything else continues while it is pending.

## Step 4. Interview (writes `business/`)
One question at a time. Accept rough answers; you write them up properly. Cover:
1. Business name, owner's first name, trade(s), towns or areas served.
2. Hours. What happens after hours: emergency service or next morning?
3. Owner's cell number (E.164). Confirm it back.
4. Services and rough price ranges, or "never mention prices".
5. Diagnostic / service-call fee, if any.
6. Emergencies they handle. Their gas utility's emergency number (look it up for their area and confirm with them).
7. What they always ask a new customer (equipment brand and age, photo of the label, address, owner or tenant...).
8. Three texts they sent customers recently (to copy their voice). How they sign off.
9. Assistant signature for disclosure, e.g. "(Sam's assistant)". Recommend keeping it on.
10. Booking link and Google review link, if they have them.
Write `business/profile.md`, `services-and-prices.md`, `faq.md`, `triage.md`, `emergency.md`, `voice.md`, and fill
`business/settings.json`. Show a 5-line summary and ask "anything wrong?".

## Step 5. Dry run (before anything is live)
`npm install`, then `npx tsx scripts/simulate.ts` with 5 realistic customer texts for their trade: a new no-heat job,
a price question, an emergency (gas smell), an existing customer rescheduling, and spam. Show each reply as it would
appear on a phone. Ask what sounds off; fix `voice.md` / `faq.md` and rerun only the ones they flagged.

## Step 6. Deploy
1. `npx wrangler d1 create textback`, put the id in `wrangler.toml`, then
   `npx wrangler d1 execute textback --remote --file src/db/schema.sql`.
2. Secrets: `npx wrangler secret put` for `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `STATUS_TOKEN` (generate this one yourself with `openssl rand -hex 24` and pipe it in; save it to `.dev.vars`).
3. `npx wrangler deploy`. Put the workers.dev URL into `wrangler.toml` as `PUBLIC_URL` and deploy again.
4. `npx tsx scripts/twilio-setup.ts webhooks --number <E.164> --url <PUBLIC_URL>` points SMS and voice at the Worker.
5. `curl <PUBLIC_URL>/health` must say ok.

## Step 7. Live test
Run `npx wrangler tail` in the background and watch it while they test:
1. Someone else texts the business number "hi, my furnace won't turn on". Owner should get the forward right away, and
   the customer gets an AI reply 3 minutes later if the owner doesn't answer.
2. Owner texts `busy 1h`, the tester texts again: reply within ~15 s, owner gets a summary.
3. Owner texts `list`, then `call <name>`: their phone rings and connects.
4. Tester calls the business number and doesn't get answered: missed-call text arrives.
5. Owner texts `back`.
If registration is still pending, texts may be blocked by carriers: say so plainly, finish the tests that can run, and
leave the rest in `setup-progress.md` for later.

## Step 8. Extras (offer each once)
- Import customers: ask for a CSV export (Jobber, Housecall Pro, ServiceTitan, phone contacts), then
  `npx tsx scripts/import-customers.ts <file>` and show how many came in.
- iPhone Driving Focus automation: walk them through `shortcuts/README.md` using their `STATUS_TOKEN`.
- Cheat-sheet: write `OWNER_CHEATSHEET.md` with their commands using real customer names from the test.

Finish with a three-line summary: the business number, what happens when a customer texts, and "type
/textback-manage to change anything".
