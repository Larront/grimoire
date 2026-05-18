-- Tag index derived from note frontmatter. Tag-string keyed: the row's identity
-- is (note_path, tag); there is no surrogate tag_id. Listing all distinct tag
-- values is `SELECT DISTINCT tag FROM note_tags`. Index is fully regenerable
-- from a vault scan — frontmatter is the source of truth.
CREATE TABLE note_tags (
    note_path TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_path, tag)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag);
