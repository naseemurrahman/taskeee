'use strict';

const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function requestContext(req, res, next) {
  const requestId = req.get('X-Request-ID') || randomUUID();
  const started = Date.now();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      event: 'HTTP_REQUEST',
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
      userId: req.user?.id || null,
      orgId: req.user?.org_id || req.user?.orgId || null,
      ip: req.ip,
      userAgent: req.get('User-Agent') || null,
    });
  });

  next();
}

module.exports = { requestContext };
