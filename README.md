# TextBack

Your customers text. You're driving, on a roof, or asleep. TextBack answers them in under a minute, in your voice,
asks the right questions, and texts you a one-line summary with a callback reminder. You stay in charge from your
normal texting app.

- Answers customer texts when you're busy, and any text you haven't answered in 3 minutes
- Texts back anyone whose call you missed
- Spots emergencies (gas smell, CO alarm, no heat with a baby at home) and calls you right away
- Reminds you to call people back; text `call priya` and it connects you from the business number
- Remembers every customer: equipment, address, landlord, notes you text it
- Never books a time or quotes a firm price without you

## Install
1. Install [Claude Code](https://claude.com/claude-code).
2. Download this folder, open it in a terminal, run `claude`.
3. Type `/textback-setup` and answer its questions.

You'll need a Twilio account, an Anthropic API key and a free Cloudflare account. The setup walks you through each.
Running cost is about $20-25 a month for a one-truck shop.

## After install
Text the business number from your own cell:

| Text | What happens |
|---|---|
| `busy 2h` / `back` | assistant takes over / hands back |
| `priya be there at 3` | sends that to Priya as you |
| `call priya` | your phone rings, then connects you to Priya |
| `note priya landlord is Raj` | saved to her card |
| `list` | today's callbacks |
| `pause` / `resume` | turns the assistant off / on |

Want to change something bigger ("add our new duct cleaning price", "who's overdue?")? Open Claude Code in this
folder and type `/textback-manage`.

How it works inside: [BLUEPRINT.md](BLUEPRINT.md).
