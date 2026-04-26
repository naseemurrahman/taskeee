-- Normalize legacy task assignees from employees.id -> users.id when possible.
-- Safe to run multiple times.
UPDATE tasks t
SET assigned_to = e.user_id
FROM employees e
WHERE t.assigned_to = e.id
  AND e.user_id IS NOT NULL
  AND t.org_id = e.org_id;
