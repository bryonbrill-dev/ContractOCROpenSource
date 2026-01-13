PRAGMA foreign_keys = ON;

-- =========================
-- Contracts + file storage
-- =========================
CREATE TABLE IF NOT EXISTS contracts (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  vendor          TEXT,
  agreement_type  TEXT,                       -- NEW: Addendum, Amendment, etc.
  original_filename TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  stored_path     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  pages           INTEGER DEFAULT 0,
  uploaded_at     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'processed'
);

CREATE INDEX IF NOT EXISTS idx_contracts_uploaded_at ON contracts(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_contracts_vendor ON contracts(vendor);
CREATE INDEX IF NOT EXISTS idx_contracts_agreement_type ON contracts(agreement_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contracts_sha256 ON contracts(sha256);

-- =========================
-- Tags
-- =========================
CREATE TABLE IF NOT EXISTS tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  color         TEXT DEFAULT '#3b82f6',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_tags (
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (contract_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_tags_contract ON contract_tags(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_tags_tag ON contract_tags(tag_id);

CREATE TABLE IF NOT EXISTS tag_roles (
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  role_id       INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (tag_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_roles_tag ON tag_roles(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_roles_role ON tag_roles(role_id);

-- =========================
-- Tag keywords (for auto-generation)
-- =========================
CREATE TABLE IF NOT EXISTS tag_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  keyword       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tag_keywords_tag ON tag_keywords(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tag_keywords_tag_keyword ON tag_keywords(tag_id, keyword);

-- =========================
-- Agreement types + keywords
-- =========================
CREATE TABLE IF NOT EXISTS agreement_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agreement_type_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_type_id INTEGER NOT NULL REFERENCES agreement_types(id) ON DELETE CASCADE,
  keyword       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agreement_type_keywords_type ON agreement_type_keywords(agreement_type_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agreement_type_keywords_type_keyword ON agreement_type_keywords(agreement_type_id, keyword);

-- =========================
-- OCR text (per page)
-- =========================
CREATE TABLE IF NOT EXISTS ocr_pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  page_number   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ocr_pages_contract_page ON ocr_pages(contract_id, page_number);

-- =========================
-- Term taxonomy (pre-defined catalog)
-- =========================
CREATE TABLE IF NOT EXISTS term_definitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  key            TEXT NOT NULL UNIQUE,
  value_type     TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  priority       INTEGER NOT NULL DEFAULT 100,
  extraction_hint TEXT,
  created_at     TEXT NOT NULL
);

-- =========================
-- Extracted term instances (per contract)
-- =========================
CREATE TABLE IF NOT EXISTS term_instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  term_key        TEXT NOT NULL REFERENCES term_definitions(key),
  value_raw       TEXT,
  value_normalized TEXT,
  confidence      REAL NOT NULL DEFAULT 0.0,
  status          TEXT NOT NULL DEFAULT 'smart',
  source_page     INTEGER,
  source_snippet  TEXT,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_term_instances_contract ON term_instances(contract_id);
CREATE INDEX IF NOT EXISTS idx_term_instances_termkey ON term_instances(term_key);

-- =========================
-- Events (drives Month view + reminders)
-- =========================
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  event_date    TEXT NOT NULL,
  derived_from_term_key TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

-- =========================
-- Reminder settings (per event)
-- =========================
CREATE TABLE IF NOT EXISTS reminder_settings (
  event_id      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  recipients    TEXT NOT NULL,
  offsets_json  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_days   INTEGER NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL,
  error         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reminder_sends_unique
  ON reminder_sends(event_id, offset_days, scheduled_for);

-- =========================
-- Notification users
-- =========================
CREATE TABLE IF NOT EXISTS notification_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_users_email_lower
  ON notification_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_notification_users_name ON notification_users(name);

-- =========================
-- Authentication + roles
-- =========================
CREATE TABLE IF NOT EXISTS auth_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_users_email_lower
  ON auth_users(lower(email));

CREATE TABLE IF NOT EXISTS auth_roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id       INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role_id       INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_roles_user ON auth_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_user_roles_role ON auth_user_roles(role_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- =========================
-- Notification delivery logs
-- =========================
CREATE TABLE IF NOT EXISTS notification_logs (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL,
  error          TEXT,
  related_id     TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_kind ON notification_logs(kind);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);

-- =========================
-- Pending agreements queue
-- =========================
CREATE TABLE IF NOT EXISTS pending_agreements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  owner         TEXT NOT NULL,
  owner_email   TEXT,
  contract_id   TEXT,
  due_date      TEXT,
  status        TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_agreements_created_at
  ON pending_agreements(created_at);

-- =========================
-- Pending agreement reminder rules
-- =========================
CREATE TABLE IF NOT EXISTS pending_agreement_reminders (
  id              TEXT PRIMARY KEY,
  frequency       TEXT NOT NULL,
  roles_json      TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  message         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_agreement_reminders_created_at
  ON pending_agreement_reminders(created_at);

-- =========================
-- Task queue
-- =========================
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  due_date       TEXT NOT NULL,
  recurrence     TEXT NOT NULL DEFAULT 'none',
  reminders_json TEXT NOT NULL,
  assignees_json TEXT NOT NULL,
  completed      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_created_at
  ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed
  ON tasks(completed);

-- =========================
-- Job runs
-- =========================
CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,
  detail       TEXT
);

-- =========================
-- Full-text search (FTS5)
-- =========================
CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(
  contract_id UNINDEXED,
  title,
  vendor,
  ocr_text
);
