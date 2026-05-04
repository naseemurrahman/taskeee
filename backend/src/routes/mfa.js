'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticator } = require('otplib');
const { authenticate } = require('../middleware/auth');
const { query } = require('../utils/db');
const { sha256Hex, randomToken, encryptString } = require('../utils/crypto');

const router = express.Router();
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function makeTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function makeOtpAuthUrl({ issuer, accountName, secret }) {
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

async function ensureMfaSchema() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`);
  await query(`CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

router.post('/mfa/enroll/start', authenticate, async (req, res) => {
  try {
    const issuer = String(process.env.MFA_ISSUER || 'Taskee').trim() || 'Taskee';
    const accountName = String(req.user?.email || req.user?.id || 'user').trim() || 'user';
    const secret = makeTotpSecret();
    const otpauthUrl = makeOtpAuthUrl({ issuer, accountName, secret });
    return res.json({ issuer, accountName, secret, otpauthUrl });
  } catch (err) {
    console.error('[MFA enroll/start] failed:', err?.stack || err?.message || err);
    return res.status(500).json({ error: 'Failed to start MFA enrollment', code: 'MFA_ENROLL_START_FAILED' });
  }
});

router.post('/mfa/enroll/confirm', authenticate, async (req, res) => {
  try {
    await ensureMfaSchema();
    const { secret, code } = req.body || {};
    if (!secret || typeof secret !== 'string') return res.status(400).json({ error: 'secret is required' });
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'code is required' });

    authenticator.options = { window: 1 };
    const ok = authenticator.check(String(code).replace(/\s+/g, ''), secret);
    if (!ok) return res.status(401).json({ error: 'Invalid MFA code' });

    const enc = encryptString(secret, 'MFA_ENCRYPTION_KEY');
    await query(
      `UPDATE users SET mfa_enabled = TRUE, mfa_secret_enc = $1, mfa_enrolled_at = NOW() WHERE id = $2`,
      [enc, req.user.id]
    );

    await query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [req.user.id]);
    const codes = Array.from({ length: 10 }).map(() => randomToken(10));
    for (const c of codes) {
      await query(
        `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
        [req.user.id, sha256Hex(String(c).toLowerCase())]
      );
    }
    return res.json({ message: 'MFA enabled', recoveryCodes: codes });
  } catch (err) {
    console.error('[MFA enroll/confirm] failed:', err?.stack || err?.message || err);
    return res.status(500).json({ error: 'Failed to confirm MFA enrollment', code: 'MFA_ENROLL_CONFIRM_FAILED' });
  }
});

module.exports = router;
