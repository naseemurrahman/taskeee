-- Align organizations.plan check constraint with app plan keys
-- App uses: basic, pro, enterprise

DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'organizations'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%plan%'
    AND pg_get_constraintdef(c.oid) ILIKE '%in%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE organizations DROP CONSTRAINT %I', conname);
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- table doesn't exist yet
  NULL;
END $$;

-- Normalize legacy plan values before the new CHECK (e.g. seed uses 'business')
UPDATE organizations SET plan = 'pro' WHERE lower(trim(coalesce(plan, ''))) IN ('business', 'professional');
UPDATE organizations SET plan = 'basic' WHERE plan IS NULL OR trim(coalesce(plan, '')) = '' OR lower(trim(plan)) = 'starter';
UPDATE organizations SET plan = 'basic' WHERE plan NOT IN ('basic', 'pro', 'enterprise');

ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('basic','pro','enterprise'));

