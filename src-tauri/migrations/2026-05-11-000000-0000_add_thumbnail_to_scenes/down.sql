-- SQLite does not support DROP COLUMN in older versions; recreate table without thumbnail columns
CREATE TABLE scenes_backup AS SELECT id, name, created_at, favorited FROM scenes;
DROP TABLE scenes;
ALTER TABLE scenes_backup RENAME TO scenes;
