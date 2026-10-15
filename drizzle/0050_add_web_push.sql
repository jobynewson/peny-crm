-- 0050_add_web_push.sql
-- Web push for staff: a phone or desktop gets the alert as well as the email.
--
--   push_subscriptions  one row per device a person has switched on (Settings ›
--                       Notifications › This device). Keyed by Clerk id like
--                       notification_settings. `endpoint` is the browser's push
--                       address and is unique, so re-subscribing the same device
--                       updates its row instead of doubling it.
--   notification_settings.push  per person, per kind: true / false, or null for
--                       the kind's default (KINDS in api/_notify.js).
--   notification_settings.email becomes nullable so a row that only sets push
--                       leaves email on its default.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id   TEXT NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ok_at      TIMESTAMPTZ,
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,
  failures        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (clerk_user_id);

ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS push BOOLEAN;
ALTER TABLE notification_settings ALTER COLUMN email DROP NOT NULL;
