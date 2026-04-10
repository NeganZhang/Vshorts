const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'vshort.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Create tables ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password        TEXT NOT NULL,
    stripe_customer_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stripe_sub_id       TEXT UNIQUE,
    plan                TEXT NOT NULL DEFAULT 'free',
    status              TEXT NOT NULL DEFAULT 'active',
    current_period_end  TEXT,
    cancel_at_period_end INTEGER DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id),
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prompt      TEXT NOT NULL,
    content     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    prompt      TEXT NOT NULL DEFAULT '',
    shot_type   TEXT NOT NULL DEFAULT 'Wide Shot',
    camera_move TEXT NOT NULL DEFAULT 'Static',
    duration    TEXT NOT NULL DEFAULT '0-4s',
    image_path  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clips (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    filepath    TEXT NOT NULL,
    filesize    INTEGER,
    duration_ms INTEGER,
    mime_type   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS edit_jobs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    config      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    progress    INTEGER DEFAULT 0,
    output_path TEXT,
    error_msg   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Indexes ──────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_projects_user     ON projects(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_scripts_project   ON scripts(project_id);
  CREATE INDEX IF NOT EXISTS idx_scenes_project    ON scenes(project_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_clips_project     ON clips(project_id);
  CREATE INDEX IF NOT EXISTS idx_editjobs_project  ON edit_jobs(project_id);
  CREATE INDEX IF NOT EXISTS idx_subs_user         ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_subs_stripe       ON subscriptions(stripe_sub_id);
  CREATE INDEX IF NOT EXISTS idx_users_stripe      ON users(stripe_customer_id);
`);

module.exports = db;
