ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS lead_score integer,
  ADD COLUMN IF NOT EXISTS converted_deal_id uuid,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_leads_converted_deal_id ON crm_leads(converted_deal_id);
