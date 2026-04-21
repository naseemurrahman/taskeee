'use strict';

/**
 * SSL options for node-pg Client / Pool.
 *
 * - Unset: development → no TLS; production → TLS, accept self-signed certs
 *   (Railway, Render, Fly.io all use self-signed certificates by default).
 * - DATABASE_SSL=false: no TLS (local Docker Postgres).
 * - DATABASE_SSL=true or verify-full: TLS with strict certificate verification.
 * - DATABASE_SSL=no-verify: TLS but allow self-signed / custom CAs.
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
  // Default for production: accept self-signed certs.
  // Set DATABASE_SSL=true to enforce strict certificate verification.
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: false };
  }
  return false;
}

module.exports = { resolvePgSsl };
