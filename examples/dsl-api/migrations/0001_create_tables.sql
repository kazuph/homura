-- migrations/0001_create_tables.sql

-- Authors table (for has_many/belongs_to test)
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Articles table (belongs_to :author, enum :status, scopes, callbacks)
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT,
  body TEXT NOT NULL,
  author_id INTEGER,
  status INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES authors(id)
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Profiles table (for has_one test)
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER UNIQUE,
  bio TEXT,
  website TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES authors(id)
);
