-- Keep HRIS employee rows synchronized with workspace user accounts.
--
-- The app creates an employee row and a workspace user together. If a user is
-- removed directly from the database, the old ON DELETE SET NULL foreign key
-- left a visible employee directory row with no corresponding workspace account.
-- This migration cleans those stale rows and changes the FK to cascade future
-- user deletes into employees.

DO $$
DECLARE
  existing_fk_name TEXT;
BEGIN
  IF to_regclass('public.employees') IS NULL OR to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  -- First relink any still-valid workspace users by matching org + email.
  UPDATE employees e
     SET user_id = u.id,
         updated_at = COALESCE(e.updated_at, NOW())
    FROM users u
   WHERE e.user_id IS NULL
     AND e.org_id = u.org_id
     AND NULLIF(TRIM(COALESCE(e.work_email, '')), '') IS NOT NULL
     AND LOWER(e.work_email) = LOWER(u.email)
     AND COALESCE(u.is_active, TRUE) = TRUE;

  -- Remove employee records whose linked workspace account is gone or inactive.
  DELETE FROM employees e
   WHERE e.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM users u
        WHERE u.id = e.user_id
          AND u.org_id = e.org_id
          AND COALESCE(u.is_active, TRUE) = TRUE
     );

  -- Remove unlinked employee records that no longer match an active workspace account.
  DELETE FROM employees e
   WHERE e.user_id IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM users u
        WHERE u.org_id = e.org_id
          AND NULLIF(TRIM(COALESCE(e.work_email, '')), '') IS NOT NULL
          AND LOWER(u.email) = LOWER(e.work_email)
          AND COALESCE(u.is_active, TRUE) = TRUE
     );

  SELECT c.conname
    INTO existing_fk_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.employees'::regclass
     AND c.confrelid = 'public.users'::regclass
     AND c.contype = 'f'
     AND a.attname = 'user_id'
   LIMIT 1;

  IF existing_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', existing_fk_name);
  END IF;

  ALTER TABLE employees
    ADD CONSTRAINT employees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
END $$;
