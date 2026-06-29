-- Link/URL preview cards and checklist cards on the planning canvas.
--   url       — 'link' kind destination URL (image_url reused as thumbnail,
--               content reused as the fetched title)
--   sub_tasks — 'todo' kind checklist rows
--               ([{ id, text, owner_id, due_date, done }], owner_id is a Clerk ID)
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS sub_tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
