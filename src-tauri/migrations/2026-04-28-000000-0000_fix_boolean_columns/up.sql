-- Fix boolean columns: SQLite cannot ALTER COLUMN type.
-- Use table recreation pattern for scene_slots (is_loop, shuffle) and notes (archived).
-- Also normalize existing timestamps from SQLite datetime format to RFC3339.

PRAGMA foreign_keys = OFF;

-- ── scene_slots ──────────────────────────────────────────────────────────────

CREATE TABLE scene_slots_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    BOOLEAN NOT NULL DEFAULT TRUE,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle    BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO scene_slots_new
    SELECT
        id,
        scene_id,
        source,
        source_id,
        label,
        volume,
        CASE WHEN is_loop  != 0 THEN TRUE ELSE FALSE END,
        slot_order,
        CASE WHEN shuffle  != 0 THEN TRUE ELSE FALSE END
    FROM scene_slots;

DROP TABLE scene_slots;
ALTER TABLE scene_slots_new RENAME TO scene_slots;

-- ── notes ────────────────────────────────────────────────────────────────────

CREATE TABLE notes_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    icon         TEXT,
    cover_image  TEXT,
    parent_path  TEXT,
    archived     BOOLEAN NOT NULL DEFAULT FALSE,
    modified_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO notes_new
    SELECT
        id,
        path,
        title,
        icon,
        cover_image,
        parent_path,
        CASE WHEN archived != 0 THEN TRUE ELSE FALSE END,
        -- Normalize timestamps: convert 'YYYY-MM-DD HH:MM:SS' to RFC3339 if needed.
        -- Existing values may already be RFC3339 or SQLite datetime format.
        -- Use REPLACE to convert space separator to 'T'; append '+00:00' if plain datetime.
        CASE
            WHEN modified_at LIKE '%T%' THEN modified_at  -- already RFC3339
            ELSE REPLACE(modified_at, ' ', 'T') || '+00:00'
        END
    FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

PRAGMA foreign_keys = ON;
