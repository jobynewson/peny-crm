CREATE TABLE IF NOT EXISTS canvases (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canvas_items (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canvas_id  UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note',
  x          DOUBLE PRECISION NOT NULL DEFAULT 0,
  y          DOUBLE PRECISION NOT NULL DEFAULT 0,
  w          DOUBLE PRECISION NOT NULL DEFAULT 220,
  h          DOUBLE PRECISION NOT NULL DEFAULT 140,
  z          INTEGER NOT NULL DEFAULT 0,
  content    TEXT,
  color      TEXT,
  image_url  TEXT,
  links      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canvas_arrows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canvas_id    UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  from_item_id UUID NOT NULL REFERENCES canvas_items(id) ON DELETE CASCADE,
  to_item_id   UUID NOT NULL REFERENCES canvas_items(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS canvas_items_canvas_idx ON canvas_items (canvas_id);
CREATE INDEX IF NOT EXISTS canvas_arrows_canvas_idx ON canvas_arrows (canvas_id);
