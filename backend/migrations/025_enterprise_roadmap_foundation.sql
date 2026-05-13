-- Enterprise roadmap foundation.
-- Adds durable tables for the remaining roadmap items: push subscriptions,
-- scheduled digests, workflow automation, AI governance, approvals,
-- project milestones/KPIs, realtime conflict locks, and integration sync jobs.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active ON push_subscriptions(user_id, is_active);

CREATE TABLE IF NOT EXISTS notification_digest_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'daily',
  delivery_hour INTEGER NOT NULL DEFAULT 8,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  include_overdue BOOLEAN NOT NULL DEFAULT TRUE,
  include_due_today BOOLEAN NOT NULL DEFAULT TRUE,
  include_mentions BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (frequency IN ('off','daily','weekly')),
  CHECK (delivery_hour BETWEEN 0 AND 23)
);
CREATE INDEX IF NOT EXISTS idx_digest_prefs_org_enabled ON notification_digest_preferences(org_id, is_enabled, frequency, delivery_hour);

CREATE TABLE IF NOT EXISTS notification_digest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, frequency, period_start, period_end, channel)
);
CREATE INDEX IF NOT EXISTS idx_digest_runs_org_sent ON notification_digest_runs(org_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_cron TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trigger_type IN ('task.created','task.updated','task.overdue','project.completed','employee.offboarded','schedule'))
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_org_trigger ON automation_rules(org_id, trigger_type, is_enabled);

CREATE TABLE IF NOT EXISTS automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_automation_exec_rule_started ON automation_executions(rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_exec_org_started ON automation_executions(org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_governance_settings (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  allow_external_models BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_roles TEXT[] NOT NULL DEFAULT ARRAY['manager','hr','director','admin']::TEXT[],
  enabled_modules TEXT[] NOT NULL DEFAULT ARRAY['insights','chat','recommendations']::TEXT[],
  require_explanations BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days INTEGER NOT NULL DEFAULT 90,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  explanation TEXT,
  input_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_action_audit_org_created ON ai_action_audit(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  decision_note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending','approved','rejected','cancelled','expired'))
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_org_status ON approval_requests(org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('open','at_risk','completed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id, status, due_date);

CREATE TABLE IF NOT EXISTS realtime_resource_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  locked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lock_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_realtime_locks_expires ON realtime_resource_locks(expires_at);

CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'pull',
  status TEXT NOT NULL DEFAULT 'queued',
  cursor_value TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (provider IN ('slack','teams','google','jira','github','erp','discord')),
  CHECK (direction IN ('pull','push','bidirectional')),
  CHECK (status IN ('queued','running','success','failed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_org_provider ON integration_sync_jobs(org_id, provider, created_at DESC);
