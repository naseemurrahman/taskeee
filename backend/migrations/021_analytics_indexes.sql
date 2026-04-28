-- Analytics query performance indexes
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks (org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_created_at ON tasks (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_org_due_date ON tasks (org_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assigned_to ON tasks (org_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_org_project_id ON tasks (org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_completed_at ON tasks (org_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_org_ai_validation ON tasks (org_id, ai_validation_status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_ai_confidence ON tasks (org_id, ai_confidence_score);
