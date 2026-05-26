-- Per-tag display config for the Graph Pane.
-- color is a nullable hex string; NULL means auto-assign from accent palette cycle.
-- hidden is 0/1; 0 = visible (default).
CREATE TABLE tag_graph_styles (
    tag    TEXT    NOT NULL PRIMARY KEY,
    color  TEXT,
    hidden INTEGER NOT NULL DEFAULT 0
);
