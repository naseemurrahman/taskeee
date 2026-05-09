'use strict';

const { query } = require('./db');
const logger = require('./logger');

let ensurePromise = null;

async function ensureReportsTable() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      } catch (err) {
        logger.warn(`[reports] pgcrypto extension check skipped: ${err.message}`);
      }

      await query(`
        CREATE TABLE IF NOT EXISTS reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          generated_for UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          report_type VARCHAR(50) DEFAULT 'on_demand',
          scope_type VARCHAR(30),
          period_start TIMESTAMPTZ,
          period_end TIMESTAMPTZ,
          data JSONB DEFAULT '{}',
          email_sent BOOLEAN DEFAULT FALSE,
          email_sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS generated_for UUID REFERENCES users(id) ON DELETE CASCADE`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type VARCHAR(50) DEFAULT 'on_demand'`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS scope_type VARCHAR(30)`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`);
      await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
      await query(`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(generated_for, created_at DESC)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_reports_org_created ON reports(org_id, created_at DESC)`);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

module.exports = { ensureReportsTable };
