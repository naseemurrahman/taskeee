const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function getAesKeyFromEnv(envName) {
  let raw = process.env[envName];

  // Keep MFA usable in existing test/staging deployments that do not yet have a
  // dedicated MFA_ENCRYPTION_KEY. Production should set MFA_ENCRYPTION_KEY.
  if (!raw && envName === 'MFA_ENCRYPTION_KEY') {
    raw = process.env.JWT_SECRET || process.env.JWT_REFRESH_SECRET;
    if (raw) console.warn('MFA_ENCRYPTION_KEY missing — deriving MFA encryption key from JWT secret. Set MFA_ENCRYPTION_KEY before production.');
  }

  if (!raw) throw new Error(`Missing env var: ${envName}`);

  let buf = Buffer.from(raw, 'base64');
  // If the base64 interpretation is too short, treat the raw value as UTF-8.
  if (buf.length < 32) buf = Buffer.from(raw, 'utf8');
  if (buf.length < 32) throw new Error(`${envName} must be at least 32 bytes (base64 or utf8).`);
  return buf.subarray(0, 32);
}

function encryptString(plaintext, envKeyName) {
  if (plaintext == null) return null;
  const key = getAesKeyFromEnv(envKeyName);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptString(payload, envKeyName) {
  if (!payload) return null;
  const [v, ivB64, tagB64, dataB64] = String(payload).split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload format');
  const key = getAesKeyFromEnv(envKeyName);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = {
  sha256Hex,
  randomToken,
  encryptString,
  decryptString,
};
