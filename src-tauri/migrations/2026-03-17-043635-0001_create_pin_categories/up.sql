CREATE TABLE pin_categories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    map_id  INTEGER REFERENCES maps(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    icon    TEXT NOT NULL,
    color   TEXT NOT NULL
);
