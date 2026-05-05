-- Revert: restore INTEGER columns. Data loss on boolean precision is acceptable for rollback.
PRAGMA foreign_keys = OFF;

CREATE TABLE scene_slots_old (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    INTEGER NOT NULL DEFAULT 1,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scene_slots_old SELECT id, scene_id, source, source_id, label, volume,
    CASE WHEN is_loop THEN 1 ELSE 0 END, slot_order,
    CASE WHEN shuffle THEN 1 ELSE 0 END
FROM scene_slots;
DROP TABLE scene_slots;
ALTER TABLE scene_slots_old RENAME TO scene_slots;

CREATE TABLE notes_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    icon TEXT,
    cover_image TEXT,
    parent_path TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notes_old SELECT id, path, title, icon, cover_image, parent_path,
    CASE WHEN archived THEN 1 ELSE 0 END, modified_at
FROM notes;
DROP TABLE notes;
ALTER TABLE notes_old RENAME TO notes;

PRAGMA foreign_keys = ON;
