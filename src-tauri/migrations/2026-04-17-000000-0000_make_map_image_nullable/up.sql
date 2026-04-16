ALTER TABLE maps RENAME TO maps_old;

CREATE TABLE maps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title        TEXT NOT NULL,
    image_path   TEXT,
    image_width  INTEGER,
    image_height INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO maps SELECT * FROM maps_old;
DROP TABLE maps_old;
