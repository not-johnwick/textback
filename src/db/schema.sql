-- TextBack schema (D1 / SQLite). Times are unix milliseconds. Phones are E.164.

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  name        TEXT,
  address     TEXT,
  tags        TEXT NOT NULL DEFAULT '',      -- comma list: vip, elderly, landlord, do-not-serve, slow-payer
  equipment   TEXT NOT NULL DEFAULT '[]',    -- JSON: [{type, make, model, serial, year}]
  summary     TEXT NOT NULL DEFAULT '',      -- AI-maintained 5-line rolling summary
  opted_out   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  fact         TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('owner', 'customer', 'import', 'photo', 'voice')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  author       TEXT NOT NULL CHECK (author IN ('customer', 'ai', 'owner', 'system')),
  body         TEXT NOT NULL DEFAULT '',
  media        TEXT NOT NULL DEFAULT '[]',   -- JSON list of Twilio media URLs
  twilio_sid   TEXT UNIQUE,                  -- makes Twilio webhook retries harmless
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_customer ON messages (customer_id, created_at);

CREATE TABLE IF NOT EXISTS threads (
  customer_id        INTEGER PRIMARY KEY REFERENCES customers(id),
  tag                TEXT NOT NULL UNIQUE,   -- what the owner types: priya, priya2
  state              TEXT NOT NULL DEFAULT 'idle'
                       CHECK (state IN ('idle', 'waiting_owner', 'ai_active', 'owner_active', 'closed')),
  owner_grace_until  INTEGER,
  ai_paused_until    INTEGER,                -- set when the owner replies himself
  last_inbound_at    INTEGER,
  last_forwarded_at  INTEGER,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  kind         TEXT NOT NULL CHECK (kind IN ('callback', 'visit_request', 'quote_followup', 'review_request')),
  reason       TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',   -- JSON, e.g. requested visit windows
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  due_at       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'snoozed', 'cancelled')),
  nudged_at    INTEGER,
  created_by   TEXT NOT NULL CHECK (created_by IN ('ai', 'owner')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, due_at);

CREATE TABLE IF NOT EXISTS owner_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  mode        TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'busy', 'driving', 'off', 'paused')),
  until       INTEGER,                       -- null = until changed
  source      TEXT NOT NULL DEFAULT 'sms' CHECK (source IN ('sms', 'shortcut', 'calendar', 'manage')),
  updated_at  INTEGER NOT NULL
);
INSERT OR IGNORE INTO owner_state (id, mode, source, updated_at) VALUES (1, 'free', 'sms', 0);

CREATE TABLE IF NOT EXISTS knowledge_learned (
  id          INTEGER PRIMARY KEY,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Audit log and stats source: reply_sent, escalated, first_reply (with latency_ms), unanswered, tokens...
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER,
  kind         TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_kind ON events (kind, created_at);
