-- Quick Notes: one captured line each, held as a row and nothing else
-- (ADR-0018). No path, no title, no `notes` row — a Quick Note is not a note
-- and not a file, so nothing here references the Files tree and no derived
-- index (Link Index, Search Index, graph) ever reads this table.
--
-- `captured_at` is RFC-3339, the spelling `notes.modified_at` is written in, and
-- carries no default: every row is stamped by `create_quick_note`, so the pane's
-- day grouping never meets a second spelling of a timestamp.
CREATE TABLE quick_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    body        TEXT NOT NULL,
    captured_at TEXT NOT NULL
);
