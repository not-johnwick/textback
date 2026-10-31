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
Paste one command and answer the questions. It installs Claude Code, downloads TextBack to a `textback` folder in
your home folder, and starts `/textback-setup`. Or copy it from
[docs.scalewithvish.com/textback](https://docs.scalewithvish.com/textback).

Mac (Terminal):
```bash
curl -fsSL https://claude.ai/install.sh | bash && mkdir -p ~/textback && cd ~/textback && { [ -f README.md ] || curl -fsSL https://github.com/not-johnwick/textback/archive/refs/heads/main.tar.gz | tar -xzf - --strip-components 1; } && ~/.local/bin/claude "/textback-setup"
```

Windows (PowerShell):
```powershell
irm https://claude.ai/install.ps1 | iex; $d = "$HOME\textback"; if (!(Test-Path "$d\README.md")) { iwr https://github.com/not-johnwick/textback/archive/refs/heads/main.zip -UseBasicParsing -OutFile "$env:TEMP\textback.zip"; Expand-Archive "$env:TEMP\textback.zip" $env:TEMP -Force; Move-Item "$env:TEMP\textback-main" $d -Force }; cd $d; & "$HOME\.local\bin\claude.exe" "/textback-setup"
```

Already have Claude Code? Open this folder in it and type `/textback-setup`.

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
