import raw from "../business/settings.json";

export type Settings = typeof raw;
export const settings: Settings = raw;

/** Fills {business_name}-style placeholders from settings (used by emergency and missed-call texts). */
export function fill(template: string): string {
  const values: Record<string, string> = {
    business_name: settings.business_name,
    owner_first_name: settings.owner_first_name,
    gas_utility_name: settings.emergency.gas_utility_name,
    gas_utility_number: settings.emergency.gas_utility_number,
  };
  return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

/** True when `now` falls inside business hours in the business's timezone. */
export function inBusinessHours(now: Date = new Date()): boolean {
  // TODO: convert `now` to settings.timezone (Intl.DateTimeFormat with timeZone), look up the weekday in
  // settings.hours, compare HH:MM. A null day means closed.
  return true;
}
