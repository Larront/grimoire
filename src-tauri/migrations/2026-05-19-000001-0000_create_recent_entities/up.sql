-- MRU list of opened entities (notes, maps, scenes) across the vault.
-- Composite primary key: one row per (kind, id) pair; opening an entity
-- again updates accessed_at in-place (upsert).  Trim to 20 rows after each
-- upsert.  Stored as TEXT timestamps so ORDER BY DESC gives MRU order.
CREATE TABLE recent_entities (
    entity_kind TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    PRIMARY KEY (entity_kind, entity_id)
);
