CREATE TABLE IF NOT EXISTS user_notes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_id    text NOT NULL,
  title       text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notes_clerk_id_idx ON user_notes (clerk_id);
