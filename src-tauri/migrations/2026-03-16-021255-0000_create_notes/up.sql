-- Your SQL goes here
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT 'Untitled',
    icon TEXT,
    cover_image TEXT,
    parent_path TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT NOT NULL DEFAULT (datetime('now'))
);