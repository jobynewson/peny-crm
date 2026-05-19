CREATE TABLE IF NOT EXISTS marketing_cards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  card_type    TEXT NOT NULL DEFAULT 'ad-hoc',
  status       TEXT NOT NULL DEFAULT 'ideas',
  lead_owner_id TEXT,
  due_date     DATE,
  notes        TEXT,
  sub_tasks    JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
