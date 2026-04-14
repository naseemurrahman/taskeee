-- Integrations System Migration
-- This migration adds support for third-party integrations

-- Integrations instances table
CREATE TABLE IF NOT EXISTS integrations_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    integration_type VARCHAR(50) NOT NULL, -- communication, calendar, storage, email, project_management
    provider VARCHAR(50) NOT NULL, -- slack, google_calendar, microsoft_teams, etc.
    config JSONB NOT NULL, -- OAuth tokens, API keys, and other configuration
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_sync_at TIMESTAMP WITH TIME ZONE
);

-- OAuth states for secure OAuth flows
CREATE TABLE IF NOT EXISTS oauth_states (
    id VARCHAR(64) PRIMARY KEY, -- state parameter from OAuth flow
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    integration_type VARCHAR(50) NOT NULL,
    redirect_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Integration sync logs
CREATE TABLE IF NOT EXISTS integration_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integrations_instances(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL, -- full, incremental, manual, webhook
    status VARCHAR(20) NOT NULL, -- success, failed, partial
    details JSONB, -- sync results, error messages, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Integration webhooks for real-time sync
CREATE TABLE IF NOT EXISTS integration_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integrations_instances(id) ON DELETE CASCADE,
    webhook_id VARCHAR(100) NOT NULL, -- ID from the provider
    webhook_url TEXT NOT NULL,
    events TEXT[], -- Array of events this webhook listens for
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_integrations_instances_org_id ON integrations_instances(org_id);
CREATE INDEX IF NOT EXISTS idx_integrations_instances_provider ON integrations_instances(provider);
CREATE INDEX IF NOT EXISTS idx_integrations_instances_is_active ON integrations_instances(is_active);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_integration_id ON integration_sync_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_created_at ON integration_sync_logs(created_at);

-- RLS policies for integrations
ALTER TABLE integrations_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_webhooks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view integrations for their organization
CREATE POLICY integrations_view_org ON integrations_instances
    FOR SELECT USING (org_id = current_setting('app.current_org_id')::UUID);

-- Policy: Users can create integrations for their organization
CREATE POLICY integrations_create_org ON integrations_instances
    FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id')::UUID);

-- Policy: Admins can update integrations
CREATE POLICY integrations_update_admin ON integrations_instances
    FOR UPDATE USING (
        org_id = current_setting('app.current_org_id')::UUID AND 
        current_setting('app.user_role') IN ('admin', 'director')
    );

-- Policy: Users can view sync logs for their organization's integrations
CREATE POLICY sync_logs_view_org ON integration_sync_logs
    FOR SELECT USING (
        integration_id IN (
            SELECT id FROM integrations_instances 
            WHERE org_id = current_setting('app.current_org_id')::UUID
        )
    );

-- Policy: OAuth states can only be accessed by the user who created them
CREATE POLICY oauth_states_user ON oauth_states
    FOR ALL USING (user_id = current_setting('app.current_user_id')::UUID);

-- Function to clean up expired OAuth states
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void AS $$
BEGIN
    DELETE FROM oauth_states WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup job (if using pg_cron extension)
-- SELECT cron.schedule('cleanup-oauth-states', '0 */6 * * *', 'SELECT cleanup_expired_oauth_states();');

-- Add comments for documentation
COMMENT ON TABLE integrations_instances IS 'Stores active third-party integrations for organizations';
COMMENT ON TABLE oauth_states IS 'Temporary storage for OAuth state parameters during authentication flows';
COMMENT ON TABLE integration_sync_logs IS 'Logs of synchronization activities for integrations';
COMMENT ON TABLE integration_webhooks IS 'Webhook configurations for real-time integration updates';

-- Add integration configuration examples
COMMENT ON COLUMN integrations_instances.config IS 'JSON configuration including OAuth tokens, API keys, and provider-specific settings';
COMMENT ON COLUMN integration_sync_logs.details IS 'JSON object containing sync results, error messages, and other diagnostic information';
