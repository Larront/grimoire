-- Alias index: alternative names for a note used in wikilink resolution.
-- Populated from frontmatter aliases: [...]. See ADR-0005.
CREATE TABLE note_aliases (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    PRIMARY KEY (note_id, alias)
);
CREATE INDEX idx_note_aliases_alias ON note_aliases(alias);
