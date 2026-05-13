-- Employee lifecycle governance.
-- Adds termination records and a safe termination helper that validates active work
-- and optionally reassigns it before deactivating the linked user.

CREATE TABLE IF NOT EXISTS employee_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  effective_date DATE,
  reason TEXT,
  reassigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  active_task_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_employee_lifecycle_events_employee
  ON employee_lifecycle_events(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_lifecycle_events_org
  ON employee_lifecycle_events(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION employee_open_task_count(p_org_id UUID, p_user_id UUID)
RETURNS INTEGER
LANGUAGE SQL
AS $$
  SELECT COUNT(*)::int
    FROM tasks
   WHERE org_id = p_org_id
     AND assigned_to = p_user_id
     AND COALESCE(deleted_at IS NULL, TRUE)
     AND COALESCE(status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled');
$$;

CREATE OR REPLACE FUNCTION terminate_employee(
  p_employee_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_reassign_to UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  emp employees%ROWTYPE;
  open_count INTEGER := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF emp.user_id IS NOT NULL THEN
    SELECT employee_open_task_count(emp.org_id, emp.user_id) INTO open_count;
  END IF;

  IF open_count > 0 AND p_reassign_to IS NULL THEN
    RAISE EXCEPTION 'Cannot terminate employee with % active task(s) unless a reassignment user is provided', open_count;
  END IF;

  IF open_count > 0 THEN
    UPDATE tasks
       SET assigned_to = p_reassign_to,
           updated_at = NOW()
     WHERE org_id = emp.org_id
       AND assigned_to = emp.user_id
       AND COALESCE(deleted_at IS NULL, TRUE)
       AND COALESCE(status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled');
  END IF;

  UPDATE employees
     SET status = 'terminated',
         updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'terminated_at', NOW(),
           'terminated_by', p_actor_user_id,
           'termination_reason', p_reason,
           'termination_effective_date', p_effective_date,
           'reassigned_to', p_reassign_to
         )
   WHERE id = p_employee_id;

  IF emp.user_id IS NOT NULL THEN
    UPDATE users
       SET is_active = FALSE
     WHERE id = emp.user_id
       AND org_id = emp.org_id
       AND role <> 'admin';
  END IF;

  INSERT INTO employee_lifecycle_events (
    org_id, employee_id, user_id, event_type, effective_date, reason,
    reassigned_to, active_task_count, created_by, metadata
  ) VALUES (
    emp.org_id, emp.id, emp.user_id, 'terminated', p_effective_date, p_reason,
    p_reassign_to, open_count, p_actor_user_id,
    jsonb_build_object('active_tasks_reassigned', open_count)
  );

  RETURN jsonb_build_object(
    'employeeId', emp.id,
    'userId', emp.user_id,
    'status', 'terminated',
    'activeTaskCount', open_count,
    'reassignedTo', p_reassign_to
  );
END;
$$;
