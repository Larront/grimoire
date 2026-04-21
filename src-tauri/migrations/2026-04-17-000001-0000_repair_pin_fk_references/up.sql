-- Repair FK references broken by the maps rename migration on SQLite 3.26+.
-- That migration renamed maps→maps_old, causing SQLite to rewrite the FK in
-- pins and pin_categories to REFERENCES maps_old(id). After maps_old was
-- dropped, those FKs became dangling. This migration recreates both tables
-- with correct references to maps.

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

-- Rebuild pin_categories first (pins FK references it)
CREATE TABLE pin_categories_new (
    id      INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    map_id  INTEGER REFERENCES maps(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    icon    TEXT NOT NULL,
    color   TEXT NOT NULL,
    shape   TEXT NOT NULL DEFAULT 'circle'
);
INSERT INTO pin_categories_new SELECT * FROM pin_categories;
DROP TABLE pin_categories;
ALTER TABLE pin_categories_new RENAME TO pin_categories;

-- Rebuild pins
CREATE TABLE pins_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    map_id      INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES pin_categories(id) ON DELETE SET NULL,
    note_id     INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    shape       TEXT,
    icon        TEXT,
    color       TEXT
);
INSERT INTO pins_new SELECT * FROM pins;
DROP TABLE pins;
ALTER TABLE pins_new RENAME TO pins;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
