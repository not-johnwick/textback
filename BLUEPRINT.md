# TextBack: blueprint

An SMS assistant for a one-truck contractor who prides himself on texting clients back fast. This keeps that
promise when he is driving, on a roof, or asleep.

**The promise:** every customer text gets a real answer in under a minute. The owner stays in the loop from his own
texting app. Nothing gets promised that he didn't approve.

**The install:** open this folder in Claude Code and type `/textback-setup`. The skill interviews him, sets up Twilio,
deploys, and tests it end to end. About 45 minutes of his time. Carrier registration then runs in the background for
a few days.

---

## 1. What the owner actually sees

His whole UI is the texting app on his phone. No dashboard to learn.

```
2:41 pm  Priya (new number) -> business line:
         "hi is this northside heating? our furnace is making a loud bang when it starts"

         [owner status: DRIVING, set by his iPhone at 2:30 when CarPlay connected]

2:41 pm  Assistant -> Priya:
         "Hi Priya, yes this is Northside Heating. Quick safety check first: do you smell any gas,
          or is a CO alarm going off?"
2:42 pm  Priya: "no smell no alarm, its still heating"
2:42 pm  Assistant -> Priya:
         "Good. Sam is on the road and will call you before 4:30 today to book a visit. If you can,
          send a photo of the label inside the furnace door so he comes with the right parts.
          (Sam's assistant)"
2:43 pm  Priya: [photo of the nameplate]

2:43 pm  -> Owner's phone:
         "NEW priya (Priya S, Mississauga). Furnace bangs on startup. No gas, no CO, still heating.
          Lennox EL296, 2014 (from her photo). Told her you'll call before 4:30.
          Reply: priya <text> | call priya | note priya <fact>"

4:15 pm  -> Owner: "Reminder: call priya before 4:30 (furnace banging). Reply 'call priya'."
4:16 pm  Owner: "call priya"
         [Twilio rings the owner: "Connecting you to Priya, furnace banging on startup."
          then dials Priya from the business number. His personal cell stays private.]
6:02 pm  Owner: "note priya tenant, landlord is Raj 416 555 0199, bill landlord"
6:02 pm  -> Owner: "Saved to Priya S."
```

Friday 5 pm, the weekly text:

```
This week: 41 customer texts, median first reply 38 s (yours: 6 min).
27 answered by me, 14 by you. 9 callbacks, 8 done, 1 overdue (dave).
3 visits requested, 2 booked. 4 questions I couldn't answer: reply 'teach' to fill them in.
```

That last number is the one worth bragging about.

---

## 2. Architecture

```
                         Customer's phone
                               |  SMS / MMS / call
                               v
                      Twilio number (the business line)
                               |  webhooks (signed)
                               v
   +------------------- Cloudflare Worker --------------------+
   |                                                          |
   |  /twilio/sms ---> is it the owner? --yes--> Owner commands
   |        |                 no                              |
   |        v                                                 |
   |   pre-check: STOP, emergency words, loop guard           |
   |        |                                                 |
   |        v                                                 |
   |   Thread mailbox (one Durable Object per customer)       |
   |     - batches bursts ("hi" / "my furnace" / "is loud")   |
   |     - owner free? forward now, wait 3 min for him        |
   |     - owner busy? answer after a 10 s debounce           |
   |        |                                                 |
   |        v                                                 |
   |   Brain: Claude + 6 tools  --->  Executor + guardrails   |
   |   (business files, customer      (send reply, callback, |
   |    card, thread history)          escalate call, notify)|
   |                                                          |
   |  /twilio/voice ---> ring owner 20 s --no answer--> text back
   |  /status <--- iPhone Shortcut (driving / on a job / free)|
   |  cron every minute ---> reminders, digest, weekly report |
   +----------------------------|-----------------------------+
                                v
                 D1 (SQLite): customers, facts, messages,
                 threads, reminders, owner_state, events
```

**Stack and why**

| Piece | Choice | Why |
|---|---|---|
| Phone line | Twilio | SMS, MMS, voice and call bridging in one account; REST API is simple |
| Runtime | Cloudflare Workers (Paid, $5/mo) | One command deploy, always on, no server to patch. Free plan's 10 ms CPU cap is too tight for the Claude SDK |
| Per-customer timer | Durable Object `Thread` | Serialises one customer's texts (no double replies), holds the debounce / owner-grace alarm |
| Data | D1 (SQLite) | Lives in his own Cloudflare account; plain SQL; Claude Code can query it for him |
| Brain | Claude API, `claude-opus-5-5` at `effort: low` | Best judgment on messy texts. Configurable in `business/settings.json` (Haiku 5.5 is ~20x cheaper if he wants it) |
| Admin panel | Claude Code + `/textback-manage` | "add a FAQ", "who's overdue", "pause the bot" in plain English. No web app to build in v1 |

Rejected: Twilio Functions (10 s limit, no timers), n8n / Zapier (a workflow, per-task pricing, brittle to install),
a VPS (he'd have to maintain it).

---

## 3. Components

### 3.1 Inbound SMS (`src/routes/sms.ts`)
1. Verify `X-Twilio-Signature`; drop anything unsigned.
2. Store the message. `MessageSid` is unique, so Twilio retries never double-process.
3. From the owner's cell? Go to Owner commands (3.6).
4. Pre-check (`src/brain/safety.ts`), deterministic, no AI:
   - STOP / START / HELP: record opt-out (Twilio also enforces it on its side).
   - Emergency words (gas smell, CO alarm, sparks, flooding, no heat + baby/elderly): send the fixed safety text from
     `business/emergency.md` at once, then **call** the owner (3.5). The AI still runs afterwards for follow-up.
   - Loop guard: other bots, auto-replies, more than N inbound per minute.
5. Ask "who answers?" (3.3). If the owner is free, forward the text to him immediately.
6. Poke the customer's `Thread` mailbox with a delay: grace window (default 3 min) if the owner is free, debounce
   (default 10 s) if not.
7. Return empty TwiML right away (Twilio's webhook times out at 15 s; the work runs in `waitUntil` / the alarm).

### 3.2 Thread mailbox (`src/thread.ts`)
One Durable Object per customer number. When its alarm fires it runs one **turn** (`src/brain/turn.ts`):
- Did the owner reply after the last inbound? Then stay quiet.
- Over the AI reply budget for this hour? Escalate instead of replying.
- Otherwise build the context, ask the brain, run the executor.

### 3.3 Who answers? (`src/owner/availability.ts`)
Layered, first match wins:
1. **Manual**: owner texts `busy 2h`, `driving`, `back`, `off till monday`, `pause` (kill switch: AI never replies).
2. **Phone automation**: an iPhone Shortcut pings `/status` when Driving Focus turns on or off, or when he arrives at /
   leaves a job address (`shortcuts/README.md`). Android: the same with Tasker or Samsung Routines.
3. **Calendar** (v2): busy blocks from his Google Calendar's secret iCal URL. No OAuth.
4. **Business hours** from `business/settings.json`. After hours the AI answers and promises a callback in the morning.

Even when he is "free", the AI covers any text he hasn't answered within the grace window.

### 3.4 Brain (`src/brain/agent.ts`, `prompt.ts`, `tools.ts`)
One Claude request per turn with the tool runner. Context, stable first so it caches:
- System: house rules + `business/*.md` (profile, services and prices, FAQ, triage questions, emergency, voice).
- Then volatile: learned facts (from `teach`), the customer card (name, address, equipment, tags, rolling summary,
  open reminders), the last 30 messages of the thread (customer, AI and owner, labelled), and the new texts.
- Photos from MMS go in as images (nameplates, error codes, leaks).

Tools. The model never texts anyone directly: tools only queue actions; the executor applies them.

| Tool | What it queues |
|---|---|
| `send_reply(text)` | the one text to the customer this turn |
| `save_customer_fact(fact, field?)` | name, address, equipment, preference, landlord... onto the card |
| `create_callback(reason, due_by, priority)` | a reminder for the owner to call |
| `request_visit(job_summary, windows[])` | a visit request the owner approves with `yes <name>` |
| `escalate_now(reason)` | phone call to the owner right now |
| `close_thread(reason)` | resolved, spam, wrong number, vendor, job seeker |

House rules live in `src/brain/prompt.ts`. The important ones: answer in the customer's language; ask the triage
questions, never diagnose; prices only as ranges from `services-and-prices.md`, always "final price after he sees
it"; never confirm a time slot, only offer to request one; never reveal another customer's details; short plain
texts, no emoji.

### 3.5 Executor and guardrails (`src/brain/execute.ts`)
Hard rules in code, so a bad model turn can't break them:
- Only `send_reply` text ever reaches a customer. Max one per turn.
- Drop the reply if the owner texted that customer while the model was thinking.
- Never text an opted-out number. No non-reply texts in quiet hours (default 9 pm to 8 am).
- Reply budget: max 4 AI texts per customer per hour, then escalate.
- Clean to GSM-7 (no emoji or curly quotes: 160 characters per segment instead of 70). Cap at 3 segments.
- Links only from an allow-list (his booking link, review link).
- Disclosure: the first AI text to a customer in 24 h ends with the signature from settings, e.g. "(Sam's assistant)".
- If the model ended without `send_reply` or `close_thread`, tell the owner: "Didn't know how to answer priya: ...".
- Every action is written to `events` (for the weekly report and for "what did the bot say to Dave?").

`escalate_now` and `call <name>` use a **bridged call**: Twilio calls the owner, reads a one-line whisper
("Urgent: Priya, smells gas"), then dials the customer from the business number.

### 3.6 Owner channel (`src/owner/commands.ts`, `notify.ts`)
Owner texts the business number from his cell. Fast path is plain keywords; anything else goes to Claude with
structured output, so "tell priya I'll be there at 3 and remind me to bring a 40/5 capacitor" just works.

| He texts | It does |
|---|---|
| `priya be there at 3` | sends "be there at 3" to Priya as him; stops the AI on that thread for 2 h |
| `call priya` | bridged call to Priya |
| `note priya <anything>` | saves a fact to her card |
| `yes priya` / `no priya` | approves / declines her visit request; the AI tells her |
| `done priya` / `snooze priya 1h` | closes / delays the reminder |
| `list` or `today` | open callbacks and visit requests |
| `busy 2h`, `driving`, `back`, `off till mon` | sets his status |
| `pause` / `resume` | kill switch for the AI |
| `teach <fact>` | adds to what the AI knows ("we don't do boilers") |
| photo + `priya` | attaches the photo to Priya; nameplates are read into equipment |
| (calls the business line from his cell) | voice note: "Priya, replaced igniter, follow up in spring" is transcribed and filed (v2) |

Thread names are the customer's first name, lower case (`priya`, `priya2` on a clash). A reply with no name goes to
the most recent thread if it was forwarded in the last 10 minutes; otherwise it asks "Who's that for? priya / dave".

### 3.7 Missed-call text back (`src/routes/voice.ts`)
Calls to the business number ring his cell for 20 s with the business caller ID. No answer: the caller gets
"Hi, it's Northside Heating, sorry we missed you. Sam's on a job. What's going on with your system?" and the
conversation continues in the normal flow.

If he keeps his old number on his cell, he sets carrier call-forwarding on no-answer to the Twilio number. Then only
missed calls reach Twilio. Texts to his old cell number can't be read by anyone but him: for texts, the Twilio number
has to be the published business line (3.10).

### 3.8 Customer memory
The card fills itself from every source:
- **Import**: CSV from Jobber / Housecall Pro / ServiceTitan or a phone-contacts export (`scripts/import-customers.ts`).
- **Owner**: `note` texts, photos, voice notes (v2), or Claude Code ("add Raj as Priya's landlord").
- **Conversations**: the AI saves facts customers mention ("it's a Carrier from 2012").
- **Rolling summary**: after each closed thread the AI rewrites a 5-line summary of the customer.
- Tags change behaviour: `vip` (always escalate), `elderly` (no-heat = emergency), `do-not-serve` (polite decline),
  `landlord`, `slow-payer` (deposit required).

### 3.9 Reminders and reports (`src/jobs/tick.ts`, cron every minute)
- Due reminders become a text to the owner (and again at +30 min if not done).
- Morning digest at 7:00: today's callbacks, open visit requests, anything overdue.
- Weekly report (Friday 17:00): volume, median first reply time (AI vs owner), callbacks done/overdue, visits booked,
  questions the AI couldn't answer.

### 3.10 Which number customers text
The setup skill asks this first, because it decides everything else:
- **A. New local number** (instant, ~$1-2/mo). Put it on the trucks, website and Google profile. Simplest.
- **B. Text-enable his existing landline / VoIP business number** with Twilio Hosted SMS. Calls stay where they are,
  texts go to Twilio. Needs a signed letter of authorisation; about one business day. Mobile numbers can't do this.
- **C. Port his number to Twilio.** Everything moves; 1-3 weeks; carrier risk. Only if he insists.

### 3.11 Knowledge (`business/`)
Plain markdown he never has to see: the setup interview writes it, `/textback-manage` edits it, a redeploy ships it.
`profile.md`, `services-and-prices.md`, `faq.md`, `triage.md`, `emergency.md`, `voice.md` and `settings.json`.
Things he teaches by text land in the `knowledge_learned` table and apply instantly, no redeploy.

---

## 4. Data model (`src/db/schema.sql`)

| Table | Holds |
|---|---|
| `customers` | phone (E.164, unique), name, address, tags, equipment JSON, rolling summary, opted_out |
| `facts` | one line per fact, with its source (owner, customer, import, photo, voice) |
| `messages` | every text in and out, author (customer, ai, owner, system), media, Twilio SID (unique) |
| `threads` | per customer: tag (`priya`), state, owner_grace_until, ai_paused_until, last_inbound_at |
| `reminders` | callback, visit_request, quote_followup, review_request: due_at, status, created_by |
| `owner_state` | one row: mode, until, source |
| `knowledge_learned` | facts from `teach` |
| `events` | audit log and stats: reply sent, escalation, first-reply latency |

---

## 5. Compliance (the setup skill handles each, with the owner)
- **Carrier registration.** US numbers: A2P 10DLC (sole-proprietor path if no EIN: roughly $4.50 brand + $15 vetting
  one-time + $2/mo, check Twilio's page at setup). Canadian numbers bought since March 2025, and any Canadian number
  texting US phones, also need registration. It takes days, so the skill starts it **first** and builds while it runs.
- **Consent.** Replying to someone who texted you is fine. Anything outbound that sells (seasonal tune-up blasts) needs
  consent under CASL (Canada) / TCPA (US): v3 only, owner-approved, with opt-out text.
- **AI disclosure.** On by default (signature line). Some places require it; it also keeps trust.
- **Privacy.** Customer data stays in his own Cloudflare account. Gate codes and alarm codes can be stored but are
  never sent in a reply.

---

## 6. Install (what `/textback-setup` does)
| Step | Who | Time |
|---|---|---|
| 1. Pick the number path (A / B / C) | owner answers | 2 min |
| 2. Accounts: Twilio (upgraded from trial), Anthropic API key, Cloudflare | owner signs up, skill guides | 10 min |
| 3. Buy / host the number, start carrier registration | skill via script, owner fills the brand form | 10 min, then days |
| 4. Interview: business, hours, services, prices, emergency line, how he texts | owner answers, one question at a time | 10 min |
| 5. Dry run: 5 fake customer texts, he reads the replies and corrects the voice | skill + owner | 5 min |
| 6. Deploy: D1, secrets (typed by him, never pasted in chat), Worker, webhooks | skill | 3 min |
| 7. Live test: his partner texts the line; he tries `busy 1h`, `list`, `call` | owner | 5 min |
| 8. Extras: import customers, iPhone Shortcut, cheat-sheet | optional | 5 min |

## 7. Monthly cost (one-truck shop, ~400 texts)
- Cloudflare Workers Paid: $5
- Twilio: number ~$1-2, texts roughly 1-2 cents each with carrier fees, registration ~$2: about $10
- Claude (`claude-opus-5-5`, low effort, cached system prompt): roughly 1-3 cents per turn, about $5-10
- **Total about $20-25/month.** With Haiku 5.5 the Claude part drops under $1.

---

## 8. Roadmap

**v1 (this skeleton):** inbound replies, burst batching, owner grace window, emergency pre-check + escalation call,
owner commands, bridged callbacks, missed-call text back, customer cards, CSV import, callback reminders, morning
digest, weekly report, Driving Focus shortcut, kill switch, Claude Code setup + manage skills.

**v2:** photo reading (nameplates, error codes into equipment), voice-note filing (Workers AI Whisper), Google
Calendar busy blocks, quote follow-ups ("quote priya 4800 furnace" then a drafted nudge after 3 days for his OK),
review request the day after `done`, a phone-friendly web inbox (magic link) for when he wants to scroll.

**v3:** Jobber / Housecall Pro / ServiceTitan sync, multiple techs with an on-call rotation, consented seasonal
campaigns (cold-snap watch: "-20 C Thursday, 6 customers have furnaces over 15 years old, send them a check-up
offer?"), per-customer proxy numbers so each customer is its own thread on his phone.

---

## 9. File map
```
textback/
  README.md                         what it is, install in one line
  BLUEPRINT.md                      this file
  .claude/skills/
    textback-setup/SKILL.md         installer (interview, Twilio, compliance, deploy, test)
    textback-manage/SKILL.md        day-2 admin in plain English
  business/                         the knowledge (written by the setup interview)
    settings.json  profile.md  services-and-prices.md  faq.md  triage.md  emergency.md  voice.md
  src/
    index.ts                        router + cron entry
    env.ts                          bindings and secrets
    thread.ts                       Durable Object: per-customer mailbox + timer
    twilio.ts                       signature check, send SMS, bridged call, TwiML
    settings.ts                     loads business/settings.json, business hours
    routes/sms.ts  voice.ts  status.ts
    brain/turn.ts                   should the AI answer? then decide + execute
    brain/agent.ts                  the Claude call (tool runner, refusal fallback)
    brain/prompt.ts                 house rules + per-turn context
    brain/tools.ts                  the 6 tools and the Outbox they fill
    brain/execute.ts                guardrails, sending, reminders, escalation calls
    brain/safety.ts                 STOP / emergency / auto-reply pre-check
    brain/knowledge.ts              bundles business/*.md
    owner/availability.ts  commands.ts  notify.ts
    jobs/tick.ts
    db/schema.sql  queries.ts
  scripts/twilio-setup.ts  import-customers.ts  simulate.ts  _env.ts
  shortcuts/README.md               iPhone Driving Focus -> status ping
  wrangler.toml  package.json  tsconfig.json  .dev.vars.example
```
