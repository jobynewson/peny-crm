-- Tracks monthly billable API usage so paid services (e.g. Google Places)
-- can be kept inside their free tier. One row per (service, YYYY-MM).
CREATE TABLE IF NOT EXISTS api_usage (
  service TEXT    NOT NULL,
  period  TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service, period)
);
