-- The ramp step a tag wears in the graph, 0-based; NULL until it is given one.
-- Pinned once given: a new tag takes the lowest free step rather than every tag
-- after it alphabetically moving along one (2026-10 design review). The first
-- read assigns the steps the alphabetical rule was already drawing, so no tag
-- changes colour on upgrade.
ALTER TABLE tag_graph_styles ADD COLUMN slot INTEGER;
