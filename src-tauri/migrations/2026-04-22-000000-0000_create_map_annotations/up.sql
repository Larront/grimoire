CREATE TABLE map_annotations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    map_id       INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL DEFAULT 'text',
    x            REAL    NOT NULL,
    y            REAL    NOT NULL,
    x2           REAL,
    y2           REAL,
    radius       REAL,
    label        TEXT,
    color        TEXT    NOT NULL DEFAULT '#e2e8f0',
    stroke_color TEXT    NOT NULL DEFAULT '#94a3b8',
    stroke_width INTEGER NOT NULL DEFAULT 2,
    font_size    INTEGER NOT NULL DEFAULT 16,
    opacity      REAL    NOT NULL DEFAULT 0.2,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
