'use strict';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanString(value, { min = 0, max = 500, field = 'value' } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) throw Object.assign(new Error(`${field} must be at least ${min} characters`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${field} must be at most ${max} characters`), { status: 400 });
  return text;
}

function optionalUuid(value, field = 'id') {
  if (value == null || value === '') return null;
  if (!isUuid(value)) throw Object.assign(new Error(`${field} must be a valid UUID`), { status: 400 });
  return String(value);
}

function enumValue(value, allowed, field = 'value') {
  const v = String(value || '').trim().toLowerCase();
  if (!allowed.includes(v)) throw Object.assign(new Error(`${field} must be one of: ${allowed.join(', ')}`), { status: 400 });
  return v;
}

function validatePagination(query) {
  const page = Math.max(1, Math.min(10000, parseInt(query?.page || '1', 10) || 1));
  const limit = Math.max(1, Math.min(200, parseInt(query?.limit || '30', 10) || 30));
  return { page, limit, offset: (page - 1) * limit };
}

function requireJsonBody(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object')) {
    return res.status(400).json({ error: 'JSON body is required' });
  }
  return next();
}

module.exports = { isUuid, cleanString, optionalUuid, enumValue, validatePagination, requireJsonBody };
