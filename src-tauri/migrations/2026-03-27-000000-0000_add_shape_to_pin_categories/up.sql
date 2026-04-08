ALTER TABLE pin_categories ADD COLUMN shape TEXT NOT NULL DEFAULT 'circle';

-- Normalize existing icon values to a valid PinIcon key.
-- The icon column previously held arbitrary strings; reset all to 'star'.
UPDATE pin_categories SET icon = 'star';
