CREATE TABLE scene_slots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    INTEGER NOT NULL DEFAULT 1,
    slot_order INTEGER NOT NULL DEFAULT 0
);
