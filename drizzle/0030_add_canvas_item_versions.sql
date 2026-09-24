-- Optimistic concurrency for canvas card content (text, colour, image, url,
-- links, checklist rows). A save names the version it was based on and only
-- succeeds if nobody changed the card since; otherwise the app asks the user
-- whether to keep theirs or take the teammate's. Geometry never bumps it.
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS updated_by TEXT;
