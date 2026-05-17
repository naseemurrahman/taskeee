-- Migration 028: Ensure task_categories has status and on_hold works in tasks
-- This is idempotent and safe to run on any database state

-- Add status column to task_categories (required for project pause/complete)
ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived'));

ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS color VARCHAR(20);

ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS icon VARCHAR(50);

ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Ensure on_hold is in tasks.status constraint
-- Drop old constraint and re-add with on_hold included
DO $$
BEGIN
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
  ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
    CHECK (status IN (
      'pending','in_progress','submitted','ai_reviewing',
      'ai_approved','ai_rejected','manager_approved',
      'manager_rejected','completed','overdue','cancelled','on_hold'
    ));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Add urgency column to tasks if missing (referenced by some queries)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS urgency INTEGER DEFAULT 50;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_flow JSONB DEFAULT '[]';

-- Ensure employees table has all required columns
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS department VARCHAR(100),
  ADD COLUMN IF NOT EXISTS title VARCHAR(100),
  ADD COLUMN IF NOT EXISTS location VARCHAR(100),
  ADD COLUMN IF NOT EXISTS work_email TEXT,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS manager_id UUID,
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
