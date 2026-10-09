-- 0049_office_screen.sql
-- The office screen's notes and videos.
-- A note can be shown on the office screen (is_public) until public_until, two
-- weeks after it was switched on. Office videos are YouTube links, each kept
-- under the login of the person who added it.
-- Also applied by runMigrations() in src/db/client.js.

ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS public_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS office_videos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_id   TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS office_videos_clerk_idx ON office_videos (clerk_id);
