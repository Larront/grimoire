CREATE TABLE maps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title        TEXT NOT NULL,
    image_path   TEXT NOT NULL,
    image_width  INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
