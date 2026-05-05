// middleware/security.js
// OWASP A05: Security Misconfiguration hardening
// OWASP A09: Security Logging and Monitoring
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

function rateLimitHandler(message, event) {
  return (req, res) => {
    logger.warn({ event, requestId: req.requestId, ip: req.ip, path: req.path, userAgent: req.get('User-Agent') });
    res.status(429).json({ error: message, requestId: req.requestId });
  };
}

// ── OWASP A05: Strict security headers ────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  next();
}

const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many login attempts. Please wait 5 minutes before trying again.', 'BRUTE_FORCE_BLOCK')
});

const mfaRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many MFA attempts. Please wait before trying again.', 'MFA_RATE_LIMIT_BLOCK')
});

const notificationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many notification requests. Please slow down.', 'NOTIFICATION_RATE_LIMIT_BLOCK')
});

const bulkActionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many bulk actions. Please slow down.', 'BULK_ACTION_RATE_LIMIT_BLOCK')
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again in an hour.' }
});

function auditLog(eventType, details) {
  logger.info({ event: eventType, timestamp: new Date().toISOString(), ...details });
}

function sensitiveOpLogger(req, res, next) {
  const sensitivePaths = ['/auth/', '/users/', '/reports/'];
  const isSensitive = sensitivePaths.some(p => req.path.startsWith(p));
  if (isSensitive) {
    logger.info({
      event: 'API_ACCESS',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  }
  next();
}

function preventSSRF(url) {
  if (!url) return false;
  const blocked = [
    /^https?:\/\/localhost/i,
    /^https?:\/\/127\./,
    /^https?:\/\/0\.0\.0\.0/,
    /^https?:\/\/10\./,
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
    /^https?:\/\/192\.168\./,
    /^https?:\/\/169\.254\./,
    /^https?:\/\/\[::1\]/,
    /^file:\/\//i,
    /^ftp:\/\//i,
  ];
  return blocked.some(pattern => pattern.test(url));
}

async function assertOwnsResource(userId, orgId, resourceOrgId, resourceOwner) {
  if (resourceOrgId && resourceOrgId !== orgId) throw Object.assign(new Error('Cross-organization access denied'), { status: 403 });
  if (resourceOwner && resourceOwner !== userId) throw Object.assign(new Error('Access denied'), { status: 403 });
}

module.exports = {
  securityHeaders,
  authRateLimiter,
  mfaRateLimiter,
  notificationRateLimiter,
  bulkActionRateLimiter,
  passwordResetLimiter,
  auditLog,
  sensitiveOpLogger,
  preventSSRF,
  assertOwnsResource,
};
