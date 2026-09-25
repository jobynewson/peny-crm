-- Removing a user used to fail once they had raised a task or written a
-- comment: tasks.created_by and task_comments.author_id were NOT NULL with a
-- plain foreign key. Both become nullable with ON DELETE SET NULL, so the work
-- stays on the board and reads as a former member's. Everything else keyed to
-- app_users already cascades or sets null.
--
-- Mirrors runMigrations() in src/db/client.js, which applies it at app boot.
-- A guarded DO block: it only alters what still needs it, so it is safe to run
-- on every boot and from several sessions at once, and a failure is a warning
-- that leaves the column as it was rather than an error.

DO $$
DECLARE
  col RECORD;
  fk  RECORD;
BEGIN
  FOR col IN SELECT * FROM (VALUES ('tasks', 'created_by'), ('task_comments', 'author_id')) AS v(tbl, name) LOOP
    BEGIN
      FOR fk IN
        SELECT c.conname FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.conrelid = col.tbl::regclass AND c.contype = 'f'
           AND a.attname = col.name AND c.confdeltype <> 'n'
      LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', col.tbl, fk.conname);
      END LOOP;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.conrelid = col.tbl::regclass AND c.contype = 'f'
           AND a.attname = col.name AND c.confdeltype = 'n'
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES app_users(id) ON DELETE SET NULL',
                       col.tbl, col.tbl || '_' || col.name || '_fkey', col.name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = col.tbl::regclass AND attname = col.name AND attnotnull) THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', col.tbl, col.name);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- This column is left exactly as it was (removing that user is
      -- refused, as before) and the next boot tries again.
      RAISE WARNING 'relaxing %.% failed: %', col.tbl, col.name, SQLERRM;
    END;
  END LOOP;
END $$;
