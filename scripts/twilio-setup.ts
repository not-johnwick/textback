// Twilio number setup, run by /textback-setup:
//   npx tsx scripts/twilio-setup.ts search   --area 416 [--country CA]
//   npx tsx scripts/twilio-setup.ts buy      --number +14165550123
//   npx tsx scripts/twilio-setup.ts webhooks --number +14165550123 --url https://textback.x.workers.dev
import { parseArgs } from "node:util";
import { loadDevVars, need } from "./_env";

const vars = loadDevVars();
const sid = need(vars, "TWILIO_ACCOUNT_SID");
const auth = "Basic " + Buffer.from(`${sid}:${need(vars, "TWILIO_AUTH_TOKEN")}`).toString("base64");
const API = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { area: { type: "string" }, country: { type: "string", default: "CA" }, number: { type: "string" }, url: { type: "string" } },
});

async function twilio(path: string, form?: Record<string, string>) {
  const res = await fetch(`${API}/${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  if (!res.ok) throw new Error(`Twilio ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

switch (positionals[0]) {
  case "search": {
    const q = new URLSearchParams({ AreaCode: values.area ?? "", SmsEnabled: "true", VoiceEnabled: "true", PageSize: "5" });
    const { available_phone_numbers: found } = await twilio(`AvailablePhoneNumbers/${values.country}/Local.json?${q}`);
    for (const n of found) console.log(n.phone_number, n.locality ?? "", n.region ?? "");
    break;
  }
  case "buy": {
    const n = await twilio("IncomingPhoneNumbers.json", { PhoneNumber: values.number! });
    console.log("bought", n.phone_number, n.sid);
    break;
  }
  case "webhooks": {
    const { incoming_phone_numbers: [n] } = await twilio(`IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(values.number!)}`);
    if (!n) throw new Error(`${values.number} is not on this Twilio account`);
    await twilio(`IncomingPhoneNumbers/${n.sid}.json`, {
      SmsUrl: `${values.url}/twilio/sms`, SmsMethod: "POST",
      VoiceUrl: `${values.url}/twilio/voice`, VoiceMethod: "POST",
    });
    console.log("webhooks set on", n.phone_number);
    break;
  }
  default:
    console.log("usage: search --area 416 [--country CA|US] | buy --number +1... | webhooks --number +1... --url https://...");
}
