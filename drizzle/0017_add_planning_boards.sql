CREATE TABLE IF NOT EXISTS boards (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_columns (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8590A2',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_cards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id    UUID NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee_id  UUID REFERENCES app_users(id) ON DELETE SET NULL,
  due_date     DATE,
  labels       JSONB NOT NULL DEFAULT '[]'::jsonb,
  links        JSONB NOT NULL DEFAULT '[]'::jsonb,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  spawned_from UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_recurrences (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL,
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  template   JSONB NOT NULL DEFAULT '{}'::jsonb,
  freq       TEXT NOT NULL DEFAULT 'weekly',
  interval   INTEGER NOT NULL DEFAULT 1,
  next_due   DATE NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS board_cards_board_idx ON board_cards (board_id);
CREATE INDEX IF NOT EXISTS board_columns_board_idx ON board_columns (board_id);
