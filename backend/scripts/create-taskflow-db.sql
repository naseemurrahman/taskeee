-- TaskFlow Pro — create app role + database for local PostgreSQL (when not using Docker).
-- Connect as a superuser (often "postgres"), e.g. pgAdmin Query Tool or:
--   psql -U postgres -h localhost -p 5432 -f scripts/create-taskflow-db.sql
--
-- After this succeeds:  cd backend && npm run migrate

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow') THEN
    CREATE ROLE taskflow LOGIN PASSWORD 'devpassword123';
  ELSE
    ALTER ROLE taskflow WITH PASSWORD 'devpassword123';
  END IF;
END
$$;

-- If this errors with "already exists", the database is there — run migrations only.
CREATE DATABASE taskflow_dev OWNER taskflow;
