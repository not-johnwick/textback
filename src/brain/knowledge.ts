// Worker-side loader: business/*.md bundled at deploy time. scripts/simulate.ts reads the same files from disk.
import profile from "../../business/profile.md";
import services from "../../business/services-and-prices.md";
import faq from "../../business/faq.md";
import triage from "../../business/triage.md";
import emergency from "../../business/emergency.md";
import voice from "../../business/voice.md";
import type { Knowledge } from "./prompt";

export const knowledge: Knowledge = { profile, services, faq, triage, emergency, voice };
