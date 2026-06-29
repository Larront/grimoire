-- Scene-links are the one canonical, non-regenerable piece of PDF state
-- (ADR-0011). A PDF is path-addressed, so the link is keyed by the PDF's
-- ledger-relative path plus a character range on a page; `scene_id` is a real
-- FK so deleting a Scene cascades its links away with no special logic in
-- `delete_scene`.
CREATE TABLE pdf_scene_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pdf_path     TEXT    NOT NULL,
    page         INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset   INTEGER NOT NULL,
    quote        TEXT    NOT NULL,
    scene_id     INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- List-by-path is the hot read (every PDF open loads its links); index the key.
CREATE INDEX idx_pdf_scene_links_pdf_path ON pdf_scene_links(pdf_path);
