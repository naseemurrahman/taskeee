'use strict';

/**
 * SSL options for node-pg Client / Pool.
 *
 * - Unset: development → no TLS; production → TLS with certificate verification (cloud DBs).
 * - DATABASE_SSL=false: no TLS (typical Postgres in Docker on your PC).
 * - DATABASE_SSL=true: TLS and verify server certificate.
 * - DATABASE_SSL=no-verify: TLS but allow self-signed / custom CAs (use sparingly).
 */
function resolvePgSsl() {
  const raw = (process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'require' || raw === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  if (raw === 'no-verify' || raw === 'insecure') {
    return { rejectUnauthorized: false };
  }
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: true };
  }
  return false;
}

module.exports = { resolvePgSsl };
