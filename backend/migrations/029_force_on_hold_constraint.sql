-- Migration 029: Force on_hold into tasks status constraint
-- Uses a completely safe approach: no DO block, no exceptions needed

-- First remove constraint (ok if doesn't exist), then re-add cleanly
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'pending','in_progress','submitted','ai_reviewing',
    'ai_approved','ai_rejected','manager_approved',
    'manager_rejected','completed','overdue','cancelled','on_hold'
  ));

-- Ensure task_categories has status column with correct values
ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Drop and recreate check constraint on task_categories status  
ALTER TABLE task_categories DROP CONSTRAINT IF EXISTS task_categories_status_check;
ALTER TABLE task_categories ADD CONSTRAINT task_categories_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'archived'));

-- Fix any existing tasks that have invalid status values
UPDATE tasks SET status = 'pending'
WHERE status IS NULL OR status NOT IN (
  'pending','in_progress','submitted','ai_reviewing',
  'ai_approved','ai_rejected','manager_approved',
  'manager_rejected','completed','overdue','cancelled','on_hold'
);
