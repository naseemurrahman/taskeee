// middleware/security.js
// OWASP A05: Security Misconfiguration hardening
// OWASP A09: Security Logging and Monitoring
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// ── OWASP A05: Strict security headers ────────────────────────────────────
function securityHeaders(req, res, next) {
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // XSS filter for older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Don't expose referrer on cross-origin
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // OWASP A05 – never expose server tech stack
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  next();
}

// ── OWASP A07: Credential stuffing / brute-force protection ───────────────
const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,      // 5 min lockout window
  max: 3,                       // 3 failed attempts per window per IP
  skipSuccessfulRequests: true, // don't count successful logins
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    // OWASP A09 – log brute force attempts
    logger.warn({
      event: 'BRUTE_FORCE_BLOCK',
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
    res.status(429).json({
      error: 'Too many login attempts. Please wait 5 minutes before trying again.'
    });
  }
});

// ── OWASP A07: Password reset rate limiter ────────────────────────────────
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many password reset attempts. Try again in an hour.' }
});

// ── OWASP A09: Security event audit logger ────────────────────────────────
function auditLog(eventType, details) {
  logger.info({
    event: eventType,
    timestamp: new Date().toISOString(),
    ...details
  });
}

// ── OWASP A09: Request logger for sensitive operations ────────────────────
function sensitiveOpLogger(req, res, next) {
  const sensitivePaths = ['/auth/', '/users/', '/reports/'];
  const isSensitive = sensitivePaths.some(p => req.path.startsWith(p));
  if (isSensitive) {
    logger.info({
      event: 'API_ACCESS',
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  }
  next();
}

// ── OWASP A10: SSRF Prevention - block internal IP photo uploads ──────────
function preventSSRF(url) {
  if (!url) return false;
  const blocked = [
    /^https?:\/\/localhost/i,
    /^https?:\/\/127\./,
    /^https?:\/\/0\.0\.0\.0/,
    /^https?:\/\/10\./,
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
    /^https?:\/\/192\.168\./,
    /^https?:\/\/169\.254\./,  // link-local
    /^https?:\/\/\[::1\]/,     // IPv6 loopback
    /^file:\/\//i,
    /^ftp:\/\//i,
  ];
  return blocked.some(pattern => pattern.test(url));
}

// ── OWASP A04: Object-level authorization check helper ────────────────────
async function assertOwnsResource(userId, orgId, resourceOrgId, resourceOwner) {
  if (resourceOrgId && resourceOrgId !== orgId) {
    throw Object.assign(new Error('Cross-organization access denied'), { status: 403 });
  }
  if (resourceOwner && resourceOwner !== userId) {
    // caller must handle role-based bypass (manager etc.)
    throw Object.assign(new Error('Access denied'), { status: 403 });
  }
}

module.exports = {
  securityHeaders,
  authRateLimiter,
  passwordResetLimiter,
  auditLog,
  sensitiveOpLogger,
  preventSSRF,
  assertOwnsResource,
};
