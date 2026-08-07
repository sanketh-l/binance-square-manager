-- Migration 0001_init.sql
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_cipher TEXT NOT NULL,
  key_mask TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'broadcast',
  interval_min INTEGER NOT NULL DEFAULT 60,
  daily_cap INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_post_at TEXT,
  posts24h INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  coin TEXT,
  text TEXT,
  image TEXT,
  post_url TEXT,
  content_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  error TEXT,
  format TEXT,
  hook TEXT,
  quality_score REAL,
  posted_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_posted ON posts(posted_at);