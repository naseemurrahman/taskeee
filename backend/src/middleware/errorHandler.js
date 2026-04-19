'use strict';
const logger = require('../utils/logger');

const PG_ERRORS = {
  '23505': { status: 409, message: 'Resource already exists.' },
  '23503': { status: 400, message: 'Referenced resource not found.' },
  '23502': { status: 400, message: 'A required field is missing.' },
  '23514': { status: 400, message: 'Value violates a data constraint.' },
  '42703': { status: 400, message: 'Invalid field referenced in query.' },
  '42P01': { status: 500, message: 'Database table not found — run migrations.' },
  '40001': { status: 503, message: 'Transaction conflict — please retry.' },
  '57014': { status: 503, message: 'Query cancelled — please retry.' },
  '53300': { status: 503, message: 'Too many database connections — please retry.' },
};

module.exports = function errorHandler(err, req, res, _next) {
  // Always log with context
  logger.error({
    event: 'UNHANDLED_ERROR',
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
    orgId: req.user?.org_id ?? req.user?.orgId,
    code: err.code,
  });

  // Multer file size
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 15 MB.' });
  }

  // Multer unexpected field
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.' });
  }

  // Postgres errors
  if (err.code && PG_ERRORS[err.code]) {
    const pg = PG_ERRORS[err.code];
    return res.status(pg.status).json({ error: pg.message, code: err.code });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired — please sign in again.' });
  }

  // Explicit status errors
  const status = err.status || err.statusCode || 500;
  const message = status < 500
    ? (err.message || 'Bad request.')
    : 'Internal server error. Please try again later.';

  res.status(status).json({ error: message });
};
