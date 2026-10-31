// Customer import from a CSV export (Jobber, Housecall Pro, ServiceTitan, Google/iPhone contacts):
//   npx tsx scripts/import-customers.ts customers.csv [--dry-run]
// Existing customers are filled in, never overwritten.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("usage: import-customers.ts <file.csv> [--dry-run]");

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows.shift()!.map((h) => h.trim().toLowerCase());
// TODO: exports name their columns differently. /textback-manage shows the header to Claude Code, which
// passes an explicit mapping when these guesses miss.
const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
const iName = col("full name", "name", "first");
const iLast = col("last");
const iPhone = col("mobile", "cell", "phone");
const iAddress = col("address", "street");

const now = Date.now();
const statements: string[] = [];
let skipped = 0;
for (const r of rows) {
  const phone = toE164(r[iPhone] ?? "");
  if (!phone) { skipped++; continue; }
  const name = [r[iName], iLast >= 0 && iLast !== iName ? r[iLast] : ""].filter(Boolean).join(" ").trim() || null;
  const address = iAddress >= 0 ? r[iAddress]?.trim() || null : null;
  statements.push(
    `INSERT INTO customers (phone, name, address, created_at, updated_at) VALUES (${sql(phone)}, ${sql(name)}, ${sql(address)}, ${now}, ${now}) ` +
      `ON CONFLICT(phone) DO UPDATE SET name = COALESCE(customers.name, excluded.name), address = COALESCE(customers.address, excluded.address);`,
  );
}

console.log(`${statements.length} customers ready, ${skipped} rows skipped (no usable phone number)`);
if (flag !== "--dry-run" && statements.length) {
  const out = new URL("../.wrangler/import.sql", import.meta.url);
  writeFileSync(out, statements.join("\n"));
  execFileSync("npx", ["wrangler", "d1", "execute", "textback", "--remote", "--file", out.pathname], { stdio: "inherit" });
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`; // North America default
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim().startsWith("+") && digits.length >= 8 ? `+${digits}` : null;
}

function sql(v: string | null): string {
  return v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}
