-- Order of a project's Planning tab strip (kanban boards + canvases mixed):
-- ['board:<id>' | 'canvas:<id>', …]. Boards/canvases not listed append by age.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_tab_order JSONB NOT NULL DEFAULT '[]'::jsonb;
