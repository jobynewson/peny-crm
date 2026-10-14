-- 0049_project_delete_cascades_worklist.sql
-- Deleting a project now deletes its worklist (workstreams, deliverables and the
-- rounds sent on them) instead of being refused. 0037 made
-- workstreams.project_id ON DELETE RESTRICT; it is CASCADE now. The app asks the
-- user to type DELETE before it deletes a project.
-- Also applied by runMigrations() in src/db/client.js.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'workstreams_project_id_projects_id_fk' AND confdeltype <> 'c') THEN
    ALTER TABLE workstreams DROP CONSTRAINT workstreams_project_id_projects_id_fk;
    ALTER TABLE workstreams ADD CONSTRAINT workstreams_project_id_projects_id_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;
