-- Offload Log: backup reports received from Fence. Standalone — not linked to projects.
CREATE TABLE IF NOT EXISTS offloads (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offloaded_at   TIMESTAMPTZ NOT NULL,
  year           TEXT,
  industry       TEXT,
  client         TEXT,
  project        TEXT,
  source_path    TEXT,
  drive_type     TEXT,
  location       TEXT,
  notes          TEXT,
  overall_passed BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offload_backups (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offload_id        UUID NOT NULL REFERENCES offloads(id) ON DELETE CASCADE,
  label             TEXT,
  drive_name        TEXT,
  destination_path  TEXT,
  verification_mode TEXT,
  folder_results    JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_files       INTEGER NOT NULL DEFAULT 0,
  total_size_bytes  BIGINT NOT NULL DEFAULT 0,
  passed            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offloads_year     ON offloads(year);
CREATE INDEX IF NOT EXISTS idx_offloads_industry ON offloads(industry);
CREATE INDEX IF NOT EXISTS idx_offloads_client   ON offloads(client);
CREATE INDEX IF NOT EXISTS idx_offloads_project  ON offloads(project);
CREATE INDEX IF NOT EXISTS idx_offload_backups_offload    ON offload_backups(offload_id);
CREATE INDEX IF NOT EXISTS idx_offload_backups_drive_name ON offload_backups(drive_name);
