-- Nested canvases ("boards" on the planning canvas) and connector labels.
--   canvases.parent_id           — the canvas this one is nested inside; NULL for
--                                  root canvases (the only ones listed / linked
--                                  to a project). Deleting a canvas removes its
--                                  whole sub-tree.
--   canvas_items.child_canvas_id — 'board' kind: the nested canvas it opens.
--   canvas_arrows.label          — optional text shown on the connector.
ALTER TABLE canvases ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS child_canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL;
ALTER TABLE canvas_arrows ADD COLUMN IF NOT EXISTS label TEXT;
CREATE INDEX IF NOT EXISTS canvases_parent_idx ON canvases (parent_id);
