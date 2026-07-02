-- Fractional drag-reorder index for the Projects kanban board, matching the
-- board_cards.position pattern used by Planning boards.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kanban_position DOUBLE PRECISION NOT NULL DEFAULT 0;
