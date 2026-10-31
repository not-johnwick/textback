// Typed helpers over D1. Every SQL statement in the app lives here.

export type Customer = {
  id: number;
  phone: string;
  name: string | null;
  address: string | null;
  tags: string;
  equipment: string; // JSON
  summary: string;
  opted_out: number;
};

export type Author = "customer" | "ai" | "owner" | "system";

export type Message = {
  id: number;
  customer_id: number;
  direction: "in" | "out";
  author: Author;
  body: string;
  media: string; // JSON
  created_at: number;
};

export type ThreadRow = {
  customer_id: number;
  tag: string;
  state: "idle" | "waiting_owner" | "ai_active" | "owner_active" | "closed";
  owner_grace_until: number | null;
  ai_paused_until: number | null;
  last_inbound_at: number | null;
  last_forwarded_at: number | null;
};

export type ReminderKind = "callback" | "visit_request" | "quote_followup" | "review_request";

export type Reminder = {
  id: number;
  customer_id: number;
  kind: ReminderKind;
  reason: string;
  detail: string; // JSON
  priority: "normal" | "high";
  due_at: number;
  status: "open" | "done" | "snoozed" | "cancelled";
  nudged_at: number | null;
  created_by: "ai" | "owner";
};

export type OwnerMode = "free" | "busy" | "driving" | "off" | "paused";
export type OwnerState = { mode: OwnerMode; until: number | null; source: string };

// --- customers ---

export async function upsertCustomer(db: D1Database, phone: string): Promise<Customer> {
  const now = Date.now();
  await db
    .prepare("INSERT INTO customers (phone, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO NOTHING")
    .bind(phone, now, now)
    .run();
  return (await db.prepare("SELECT * FROM customers WHERE phone = ?").bind(phone).first<Customer>())!;
}

export function getCustomer(db: D1Database, id: number) {
  return db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first<Customer>();
}

export async function setOptedOut(db: D1Database, customerId: number, optedOut: boolean) {
  await db.prepare("UPDATE customers SET opted_out = ?, updated_at = ? WHERE id = ?")
    .bind(optedOut ? 1 : 0, Date.now(), customerId).run();
}

/** name / address / tags / equipment / summary. `field` is checked against this list by the caller. */
export async function updateCustomerField(db: D1Database, customerId: number, field: string, value: string) {
  if (!["name", "address", "tags", "equipment", "summary"].includes(field)) throw new Error(`bad field ${field}`);
  await db.prepare(`UPDATE customers SET ${field} = ?, updated_at = ? WHERE id = ?`)
    .bind(value, Date.now(), customerId).run();
}

// --- facts ---

export async function addFact(db: D1Database, customerId: number, fact: string, source: string) {
  await db.prepare("INSERT INTO facts (customer_id, fact, source, created_at) VALUES (?, ?, ?, ?)")
    .bind(customerId, fact, source, Date.now()).run();
}

export async function listFacts(db: D1Database, customerId: number): Promise<string[]> {
  const { results } = await db.prepare("SELECT fact FROM facts WHERE customer_id = ? ORDER BY created_at")
    .bind(customerId).all<{ fact: string }>();
  return results.map((r) => r.fact);
}

// --- messages ---

/** Returns false when Twilio retried a message we already stored. */
export async function insertMessage(
  db: D1Database,
  m: { customerId: number; direction: "in" | "out"; author: Author; body: string; media?: string[]; twilioSid?: string },
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO messages (customer_id, direction, author, body, media, twilio_sid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(twilio_sid) DO NOTHING`,
    )
    .bind(m.customerId, m.direction, m.author, m.body, JSON.stringify(m.media ?? []), m.twilioSid ?? null, Date.now())
    .run();
  return res.meta.changes > 0;
}

export async function recentMessages(db: D1Database, customerId: number, limit: number): Promise<Message[]> {
  const { results } = await db
    .prepare("SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(customerId, limit)
    .all<Message>();
  return results.reverse();
}

export async function lastAt(db: D1Database, customerId: number, author: Author): Promise<number | null> {
  const row = await db
    .prepare("SELECT MAX(created_at) AS t FROM messages WHERE customer_id = ? AND author = ?")
    .bind(customerId, author)
    .first<{ t: number | null }>();
  return row?.t ?? null;
}

export async function aiRepliesSince(db: D1Database, customerId: number, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND author = 'ai' AND created_at > ?")
    .bind(customerId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// --- threads ---

/** Creates the thread on first contact, with a tag the owner can type (first name, else last 4 digits). */
export async function ensureThread(db: D1Database, customer: Customer): Promise<ThreadRow> {
  const existing = await getThread(db, customer.id);
  if (existing) return existing;
  const base = (customer.name?.split(" ")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "") || `c${customer.phone.slice(-4)}`;
  // TODO: retag "c0199" to the first name once the AI learns it (save_customer_fact field=name).
  for (let n = 1; ; n++) {
    const tag = n === 1 ? base : `${base}${n}`;
    const res = await db
      .prepare("INSERT INTO threads (customer_id, tag, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(customer.id, tag, Date.now())
      .run();
    if (res.meta.changes > 0) return (await getThread(db, customer.id))!;
  }
}

export function getThread(db: D1Database, customerId: number) {
  return db.prepare("SELECT * FROM threads WHERE customer_id = ?").bind(customerId).first<ThreadRow>();
}

const THREAD_FIELDS = ["state", "owner_grace_until", "ai_paused_until", "last_inbound_at", "last_forwarded_at"] as const;

export async function updateThread(
  db: D1Database,
  customerId: number,
  patch: Partial<Pick<ThreadRow, (typeof THREAD_FIELDS)[number]>>,
) {
  const keys = Object.keys(patch).filter((k) => (THREAD_FIELDS as readonly string[]).includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k as keyof typeof patch] ?? null);
  await db.prepare(`UPDATE threads SET ${sets}, updated_at = ? WHERE customer_id = ?`)
    .bind(...values, Date.now(), customerId).run();
}

export function findByTag(db: D1Database, tag: string) {
  return db
    .prepare("SELECT c.*, t.tag FROM threads t JOIN customers c ON c.id = t.customer_id WHERE t.tag = ?")
    .bind(tag.toLowerCase())
    .first<Customer & { tag: string }>();
}

/** Tags of threads active in the last 7 days, newest first (for owner-command parsing). */
export async function activeTags(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT tag FROM threads WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 30")
    .bind(Date.now() - 7 * 86_400_000)
    .all<{ tag: string }>();
  return results.map((r) => r.tag);
}

/** The thread forwarded to the owner most recently, if within `withinMs` (for replies with no name). */
export async function recentlyForwardedTag(db: D1Database, withinMs: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT tag FROM threads WHERE last_forwarded_at > ? ORDER BY last_forwarded_at DESC LIMIT 1")
    .bind(Date.now() - withinMs)
    .first<{ tag: string }>();
  return row?.tag ?? null;
}

// --- reminders ---

export async function addReminder(
  db: D1Database,
  r: { customerId: number; kind: ReminderKind; reason: string; dueAt: number; priority?: "normal" | "high"; detail?: object; createdBy: "ai" | "owner" },
) {
  await db
    .prepare(
      `INSERT INTO reminders (customer_id, kind, reason, detail, priority, due_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(r.customerId, r.kind, r.reason, JSON.stringify(r.detail ?? {}), r.priority ?? "normal", r.dueAt, r.createdBy, Date.now())
    .run();
}

export async function openReminders(db: D1Database, customerId?: number): Promise<(Reminder & { tag: string })[]> {
  const where = customerId === undefined ? "" : "AND r.customer_id = ?";
  const stmt = db.prepare(
    `SELECT r.*, t.tag FROM reminders r JOIN threads t ON t.customer_id = r.customer_id
     WHERE r.status IN ('open', 'snoozed') ${where} ORDER BY r.due_at`,
  );
  const { results } = await (customerId === undefined ? stmt : stmt.bind(customerId)).all<Reminder & { tag: string }>();
  return results;
}

/** Open reminders that are due and weren't nudged in the last 30 minutes. */
export async function dueReminders(db: D1Database, now: number) {
  const { results } = await db
    .prepare(
      `SELECT r.*, t.tag FROM reminders r JOIN threads t ON t.customer_id = r.customer_id
       WHERE r.status IN ('open', 'snoozed') AND r.due_at <= ? AND (r.nudged_at IS NULL OR r.nudged_at < ?)`,
    )
    .bind(now, now - 30 * 60_000)
    .all<Reminder & { tag: string }>();
  return results;
}

export async function updateReminder(db: D1Database, id: number, patch: { status?: Reminder["status"]; due_at?: number; nudged_at?: number }) {
  await db
    .prepare("UPDATE reminders SET status = COALESCE(?, status), due_at = COALESCE(?, due_at), nudged_at = COALESCE(?, nudged_at) WHERE id = ?")
    .bind(patch.status ?? null, patch.due_at ?? null, patch.nudged_at ?? null, id)
    .run();
}

// --- owner state ---

export async function getOwnerState(db: D1Database): Promise<OwnerState> {
  return (await db.prepare("SELECT mode, until, source FROM owner_state WHERE id = 1").first<OwnerState>())!;
}

export async function setOwnerState(db: D1Database, mode: OwnerMode, until: number | null, source: string) {
  await db.prepare("UPDATE owner_state SET mode = ?, until = ?, source = ?, updated_at = ? WHERE id = 1")
    .bind(mode, until, source, Date.now()).run();
}

// --- learned knowledge ---

export async function listLearned(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT text FROM knowledge_learned ORDER BY created_at").all<{ text: string }>();
  return results.map((r) => r.text);
}

export async function addLearned(db: D1Database, text: string) {
  await db.prepare("INSERT INTO knowledge_learned (text, created_at) VALUES (?, ?)").bind(text, Date.now()).run();
}

// --- events ---

export async function logEvent(db: D1Database, kind: string, customerId: number | null, data: object = {}) {
  await db.prepare("INSERT INTO events (customer_id, kind, data, created_at) VALUES (?, ?, ?, ?)")
    .bind(customerId, kind, JSON.stringify(data), Date.now()).run();
}
