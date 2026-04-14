-- Multi-Organization Support Migration
-- This migration adds support for users to belong to multiple organizations

-- Organization members table
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member', -- owner, admin, manager, supervisor, member
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);

-- Organization invitations table
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    token VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add plan column to organizations if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'plan') THEN
        ALTER TABLE organizations ADD COLUMN plan VARCHAR(20) DEFAULT 'starter';
    END IF;
END
$$;

-- Add settings column to organizations if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'settings') THEN
        ALTER TABLE organizations ADD COLUMN settings JSONB DEFAULT '{}';
    END IF;
END
$$;

-- Migrate existing single-org users to multi-org structure
INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
SELECT 
    org_id, 
    id as user_id, 
    CASE 
        WHEN role = 'admin' THEN 'owner'
        WHEN role = 'hr' THEN 'admin'
        ELSE role
    END as role,
    true as is_active,
    created_at as joined_at,
    id as invited_by
FROM users 
WHERE org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_is_active ON organization_members(is_active);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_token ON organization_invitations(token);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_expires_at ON organization_invitations(expires_at);

-- RLS policies for organization members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view organizations they belong to
CREATE POLICY organization_members_view_own ON organization_members
    FOR SELECT USING (
        user_id = current_setting('app.current_user_id')::UUID OR
        org_id = current_setting('app.current_org_id')::UUID
    );

-- Policy: Users can be added to organizations they have access to
CREATE POLICY organization_members_insert ON organization_members
    FOR INSERT WITH CHECK (
        user_id = current_setting('app.current_user_id')::UUID OR
        (org_id = current_setting('app.current_org_id')::UUID AND 
         current_setting('app.user_role') IN ('admin', 'owner'))
    );

-- Policy: Admins can update organization memberships
CREATE POLICY organization_members_update_admin ON organization_members
    FOR UPDATE USING (
        org_id = current_setting('app.current_org_id')::UUID AND 
        current_setting('app.user_role') IN ('admin', 'owner')
    );

-- Policy: Users can view invitations they received or sent
CREATE POLICY organization_invitations_view ON organization_invitations
    FOR SELECT USING (
        email = current_setting('app.current_user_email') OR
        invited_by = current_setting('app.current_user_id')::UUID
    );

-- Function to clean up expired invitations
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
    DELETE FROM organization_invitations WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup job (if using pg_cron extension)
-- SELECT cron.schedule('cleanup-expired-invitations', '0 2 * * *', 'SELECT cleanup_expired_invitations();');

-- Add comments for documentation
COMMENT ON TABLE organization_members IS 'Tracks user memberships across multiple organizations';
COMMENT ON TABLE organization_invitations IS 'Stores pending invitations for users to join organizations';
COMMENT ON COLUMN organization_members.role IS 'Role within the organization: owner, admin, manager, supervisor, member';
COMMENT ON COLUMN organization_invitations.token IS 'Secure token for invitation acceptance';
COMMENT ON COLUMN organizations.plan IS 'Subscription plan: starter, professional, enterprise';

-- Update existing organizations to have default plans
UPDATE organizations SET plan = 'starter' WHERE plan IS NULL;
UPDATE organizations SET settings = '{}' WHERE settings IS NULL;
