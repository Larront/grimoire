-- Link index: records every wikilink extracted from note content.
-- source_id is the authoring note's SQLite id (FK → notes.id).
-- target_path is the raw [[...]] text as written — path-keyed so broken
-- links (stub notes) are representable as rows. See ADR-0005.
CREATE TABLE note_links (
    source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_path TEXT NOT NULL,
    PRIMARY KEY (source_id, target_path)
);
CREATE INDEX idx_note_links_target_path ON note_links(target_path);
