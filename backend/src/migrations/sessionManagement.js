'use strict';

module.exports = [
  {
    version: '202605050008',
    name: 'professional_session_management',
    checksum: 'professional-session-management-v1',
    up: [
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS token_family_id UUID`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_token_hash VARCHAR(64)`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS reuse_detected_at TIMESTAMPTZ`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT`,
      `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_name TEXT`,
      `UPDATE refresh_tokens SET session_id = gen_random_uuid() WHERE session_id IS NULL`,
      `UPDATE refresh_tokens SET token_family_id = gen_random_uuid() WHERE token_family_id IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(user_id, session_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(user_id, token_family_id)`,
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active_session ON refresh_tokens(user_id, session_id, expires_at DESC) WHERE revoked = FALSE`,
    ],
  },
];
