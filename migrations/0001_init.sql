-- Ticket records for the Support Triage Agent.
-- One row per ticket; a customer (identified by the Durable Object's agent
-- name) can have many tickets over time, which is what makes this the
-- cross-session memory store (D1) as opposed to the live per-conversation
-- state that lives in the Durable Object itself.

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT,
  priority TEXT,
  transcript TEXT NOT NULL,
  draft_reply TEXT,
  final_reply TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
