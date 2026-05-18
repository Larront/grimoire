-- Pin tag store. SQLite-authoritative: pins have no markdown backing so
-- this table IS the source of truth (not a derived index). Tag values use
-- the same shape as note_tags: plain strings, case-insensitive matching,
-- original-case display, allowlist a–z 0–9 - _ /. ON DELETE CASCADE removes
-- tag rows automatically when the owning pin is deleted.
CREATE TABLE pin_tags (
    pin_id  INTEGER NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (pin_id, tag)
);
CREATE INDEX idx_pin_tags_tag ON pin_tags(tag);
