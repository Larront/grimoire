ALTER TABLE pins ADD COLUMN shape TEXT;
ALTER TABLE pins ADD COLUMN icon  TEXT;
ALTER TABLE pins ADD COLUMN color TEXT;
-- All three are NULL by default — NULL means "inherit from category"
