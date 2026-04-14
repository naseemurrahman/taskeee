-- Contractors: contractor records + documents + engagements

CREATE TABLE IF NOT EXISTS contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','onboarding','terminated')),
  full_name TEXT NOT NULL,
  email TEXT,
  phone_e164 TEXT,
  company_name TEXT,
  country_code TEXT,
  hourly_rate NUMERIC,
  currency TEXT DEFAULT 'USD',
  start_date DATE,
  end_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractors_org_name ON contractors(org_id, full_name);
CREATE INDEX IF NOT EXISTS idx_contractors_org_status ON contractors(org_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS contractor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  doc_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_documents_contractor ON contractor_documents(contractor_id, created_at DESC);

