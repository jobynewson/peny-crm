-- 0038_workstream_company_view.sql
-- Which company a workstream is for, in one place. A workstream belongs to a
-- project, and the company is whatever that project's company is NOW — so
-- changing a project's company moves its worklist with it, with nothing to keep
-- in step. Older workstreams with no project use the company stored on them.
-- Everything that used to join workstreams.company_id reads this instead.
-- (Also applied by runMigrations() in src/db/client.js.)

CREATE OR REPLACE VIEW workstream_company AS
  SELECT w.id AS workstream_id, COALESCE(p.company_id, w.company_id) AS company_id
  FROM workstreams w
  LEFT JOIN projects p ON p.id = w.project_id;
