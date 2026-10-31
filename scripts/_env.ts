import { readFileSync } from "node:fs";

/** Reads .dev.vars (KEY=VALUE lines). Never print the values. */
export function loadDevVars(): Record<string, string> {
  const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

export function need(vars: Record<string, string>, key: string): string {
  if (!vars[key]) throw new Error(`${key} is empty in .dev.vars`);
  return vars[key];
}
