ALTER TABLE maps RENAME TO maps_old;

CREATE TABLE maps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title        TEXT NOT NULL,
    image_path   TEXT NOT NULL DEFAULT '',
    image_width  INTEGER NOT NULL DEFAULT 0,
    image_height INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO maps
    SELECT id, title, COALESCE(image_path, ''), COALESCE(image_width, 0), COALESCE(image_height, 0), created_at, modified_at
    FROM maps_old;
DROP TABLE maps_old;
