CREATE TABLE pins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    map_id      INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES pin_categories(id) ON DELETE SET NULL,
    note_id     INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
