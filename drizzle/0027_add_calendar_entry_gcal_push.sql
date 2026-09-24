-- One-way push of Team Calendar entries to each user's external (Google) calendar.
-- Events are written to a dedicated "Slate" secondary calendar, never the user's own.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gcal_calendar_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gcal_push_entries BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS gcal_event_id TEXT;
ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS gcal_user_id UUID;
CREATE INDEX IF NOT EXISTS team_calendar_entries_gcal_user_idx
  ON team_calendar_entries (gcal_user_id) WHERE gcal_event_id IS NOT NULL;
