// api/_migrations.js
// Schema migrations, run with the server's DATABASE_URL (see api/_db-ops.js,
// which runs them once per server instance when the app starts). Every
// statement is idempotent, so running them again is always safe.
//
// Moved from src/db/client.js unchanged: the browser used to run this DDL
// itself on every load. Add new migrations here.

// `sql` is a neon() tagged-template client.
export async function runMigrations(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS marketing_cards (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      card_type     TEXT NOT NULL DEFAULT 'ad-hoc',
      status        TEXT NOT NULL DEFAULT 'ideas',
      lead_owner_id TEXT,
      due_date      DATE,
      notes         TEXT,
      sub_tasks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS story_plans (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      title      TEXT NOT NULL,
      blocks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    ALTER TABLE story_plans ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL
  `
  await sql`
    CREATE TABLE IF NOT EXISTS credentials (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      program    TEXT NOT NULL,
      login      TEXT,
      password   TEXT,
      url        TEXT,
      notes      TEXT,
      category   TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS team_calendar_entries (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       TEXT NOT NULL,
      assignee_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      entry_date    DATE NOT NULL,
      entry_type    TEXT NOT NULL DEFAULT 'other',
      label         TEXT NOT NULL,
      color         TEXT,
      project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
      shoot_id      UUID REFERENCES shoots(id) ON DELETE SET NULL,
      pps_phase_id  UUID,
      budget_id     UUID REFERENCES budgets(id) ON DELETE SET NULL,
      line_label    TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS end_date DATE`
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS is_deadline BOOLEAN NOT NULL DEFAULT false`
  // ── Leave planner ──────────────────────────────────────────────────────────
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 4`
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_year_start_day   INTEGER NOT NULL DEFAULT 1`
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS annual_allowance NUMERIC(5,1) NOT NULL DEFAULT 25`
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS approver_id UUID`
  await sql`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           TEXT NOT NULL,
      requester_id      UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      approver_id       UUID REFERENCES app_users(id) ON DELETE SET NULL,
      leave_type        TEXT NOT NULL DEFAULT 'holiday',
      start_date        DATE NOT NULL,
      end_date          DATE NOT NULL,
      start_half        BOOLEAN NOT NULL DEFAULT false,
      end_half          BOOLEAN NOT NULL DEFAULT false,
      total_days        NUMERIC(5,1) NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'pending',
      reason            TEXT,
      decision_note     TEXT,
      decided_by        UUID,
      decided_at        TIMESTAMPTZ,
      calendar_entry_id UUID,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS public_holidays (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id      TEXT NOT NULL,
      holiday_date DATE NOT NULL,
      name         TEXT NOT NULL DEFAULT 'Holiday',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_tokens JSONB`
  await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS gcal_event_id TEXT`
  // ── External calendar push (Team Calendar → each user's "Slate" calendar) ──
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gcal_calendar_id TEXT`
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gcal_push_entries BOOLEAN NOT NULL DEFAULT true`
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS gcal_event_id TEXT`
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS gcal_user_id UUID`
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS lead_assignee_id UUID`
  await sql`
    CREATE TABLE IF NOT EXISTS post_production_schedules (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      start_date DATE,
      end_date   DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS start_date DATE`
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS end_date DATE`
  await sql`
    CREATE TABLE IF NOT EXISTS pps_phases (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      schedule_id     UUID NOT NULL REFERENCES post_production_schedules(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      start_date      DATE,
      end_date        DATE,
      color           TEXT NOT NULL DEFAULT '#C47E3A',
      show_in_portal  BOOLEAN NOT NULL DEFAULT false,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE pps_phases ADD COLUMN IF NOT EXISTS assignee_id UUID`
  await sql`ALTER TABLE pps_phases ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb`
  // One-time backfill: convert each legacy single-block phase (its own dates) into a block
  await sql`
    UPDATE pps_phases
    SET blocks = jsonb_build_array(jsonb_build_object(
      'id',          uuid_generate_v4()::text,
      'title',       '',
      'notes',       '',
      'start_date',  start_date::text,
      'end_date',    end_date::text,
      'color',       color,
      'assignee_id', assignee_id
    ))
    WHERE (blocks IS NULL OR blocks = '[]'::jsonb)
      AND start_date IS NOT NULL
      AND end_date   IS NOT NULL
  `
  await sql`
    CREATE TABLE IF NOT EXISTS expense_entries (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id  TEXT NOT NULL,
      clerk_user_id TEXT NOT NULL,
      entry_date    DATE NOT NULL,
      type          TEXT NOT NULL,
      miles         NUMERIC(8,2),
      amount        NUMERIC(10,2),
      overnights    INTEGER,
      description   TEXT,
      project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
      other_title   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS expense_submissions (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id  TEXT NOT NULL,
      clerk_user_id TEXT NOT NULL,
      month_key     TEXT NOT NULL,
      submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clerk_user_id, month_key)
    )
  `
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS expense_recipients JSONB NOT NULL DEFAULT '[]'::jsonb`
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC(6,2) NOT NULL DEFAULT 45`
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS per_diem_rate NUMERIC(8,2) NOT NULL DEFAULT 0`

  // Migrate the legacy role tiers to the three-tier model and drop the old
  // per-permission overrides (permissions are now derived purely from role).
  // The old CHECK constraint only allowed admin/member/readonly, so it must be
  // replaced before remapping the values (and before any new user is inserted).
  await sql`ALTER TABLE shoots ADD COLUMN IF NOT EXISTS section_visibility JSONB NOT NULL DEFAULT '{}'::jsonb`
  await sql`ALTER TABLE shoots ADD COLUMN IF NOT EXISTS show_call_times BOOLEAN NOT NULL DEFAULT true`

  await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`
  await sql`UPDATE app_users SET role = 'superadmin' WHERE role = 'admin'`
  await sql`UPDATE app_users SET role = 'user'       WHERE role = 'member'`
  await sql`UPDATE app_users SET role = 'viewer'     WHERE role = 'readonly'`
  await sql`UPDATE app_users SET permissions = '{}'::jsonb WHERE permissions <> '{}'::jsonb`
  await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('superadmin','user','viewer'))`

  // ── Offload Log (backup reports from Fence) ────────────────────────────────
  await sql`
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
    )
  `
  await sql`
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
    )
  `
  // Indexes on the most likely search/filter fields.
  await sql`CREATE INDEX IF NOT EXISTS idx_offloads_year     ON offloads(year)`
  await sql`CREATE INDEX IF NOT EXISTS idx_offloads_industry ON offloads(industry)`
  await sql`CREATE INDEX IF NOT EXISTS idx_offloads_client   ON offloads(client)`
  await sql`CREATE INDEX IF NOT EXISTS idx_offloads_project  ON offloads(project)`
  await sql`CREATE INDEX IF NOT EXISTS idx_offload_backups_offload    ON offload_backups(offload_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_offload_backups_drive_name ON offload_backups(drive_name)`

  // ── Planning boards (kanban) ───────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS boards (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS board_columns (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#8590A2',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
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
    )
  `
  await sql`
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
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS board_cards_board_idx ON board_cards (board_id)`
  await sql`CREATE INDEX IF NOT EXISTS board_columns_board_idx ON board_columns (board_id)`

  // ── Planning canvases ──────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS canvases (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
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
      url        TEXT,
      links      JSONB NOT NULL DEFAULT '[]'::jsonb,
      sub_tasks  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Columns added after canvas_items shipped — idempotent for existing DBs.
  await sql`ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS url TEXT`
  await sql`ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS sub_tasks JSONB NOT NULL DEFAULT '[]'::jsonb`
  await sql`
    CREATE TABLE IF NOT EXISTS canvas_arrows (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      canvas_id    UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      from_item_id UUID NOT NULL REFERENCES canvas_items(id) ON DELETE CASCADE,
      to_item_id   UUID NOT NULL REFERENCES canvas_items(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS canvas_items_canvas_idx ON canvas_items (canvas_id)`
  await sql`CREATE INDEX IF NOT EXISTS canvas_arrows_canvas_idx ON canvas_arrows (canvas_id)`
  // Nested boards + connector labels (drizzle/0028_add_canvas_nesting.sql)
  await sql`ALTER TABLE canvases ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES canvases(id) ON DELETE CASCADE`
  await sql`ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS child_canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL`
  await sql`ALTER TABLE canvas_arrows ADD COLUMN IF NOT EXISTS label TEXT`
  await sql`CREATE INDEX IF NOT EXISTS canvases_parent_idx ON canvases (parent_id)`
  // Conflict detection on card content (drizzle/0030_add_canvas_item_versions.sql)
  await sql`ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 0`
  await sql`ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS updated_by TEXT`

  // ── Projects kanban drag-reorder ───────────────────────────────────────────
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS kanban_position DOUBLE PRECISION NOT NULL DEFAULT 0`
  // Planning tab strip order (drizzle/0029_add_planning_tab_order.sql)
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_tab_order JSONB NOT NULL DEFAULT '[]'::jsonb`

  // ── Budget sign-off / invoicing ─────────────────────────────────────────────
  // Columns declared in schema.js but never added to existing DBs — every
  // sign-off/invoice write was failing with "column does not exist".
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS include_in_pipeline BOOLEAN NOT NULL DEFAULT false`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS signed_off BOOLEAN NOT NULL DEFAULT false`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS signed_off_by TEXT`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT false`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ`
  await sql`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS invoiced_by TEXT`
}
