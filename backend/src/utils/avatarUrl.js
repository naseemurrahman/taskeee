'use strict';

/**
 * Strip whitespace from data-URL base64 payloads so browsers can decode them.
 * (Proxies, logs, or mail-safe wrapping sometimes inject newlines into base64.)
 */
function normalizeStoredAvatarUrl(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const lower = s.toLowerCase();
  const idx = lower.indexOf('base64,');
  if (idx === -1) return s;
  const head = s.slice(0, idx + 7);
  const b64 = s.slice(idx + 7).replace(/\s+/g, '');
  return head + b64;
}

module.exports = { normalizeStoredAvatarUrl };
