// middleware/validators.js
// OWASP A03: Injection prevention via strict input validation
const { body, param, query, validationResult } = require('express-validator');
const { isUUID } = require('validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

// ── Auth validators ────────────────────────────────────────────────────────
const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 1, max: 200 }).withMessage('Password required'),
  validate
];

const validateChangePassword = [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars with uppercase, lowercase and number'),
  validate
];

// ── User validators ────────────────────────────────────────────────────────
const VALID_ROLES = ['employee', 'supervisor', 'manager', 'hr', 'director', 'admin'];

const MANAGER_CREATABLE_ROLES = ['employee', 'supervisor'];

const validateUserCreate = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars, include uppercase, lowercase, and digit'),
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .matches(/^[a-zA-Z\s\-'.]+$/)
    .withMessage('Full name must be 2-100 characters, letters only'),
  body('role')
    .isIn(VALID_ROLES)
    .withMessage(`Role must be one of: ${VALID_ROLES.join(', ')}`),
  body('managerId')
    .optional()
    .isUUID().withMessage('managerId must be a valid UUID'),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .escape(),
  body('employeeCode')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .matches(/^[a-zA-Z0-9\-_]+$/)
    .withMessage('Employee code must be alphanumeric'),
  validate
];

/** Manager creates users only under their team (enforced in route). */
const validateManagerUserCreate = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars, include uppercase, lowercase, and digit'),
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .matches(/^[a-zA-Z\s\-'.]+$/)
    .withMessage('Full name must be 2-100 characters, letters only'),
  body('role')
    .isIn(MANAGER_CREATABLE_ROLES)
    .withMessage(`Role must be one of: ${MANAGER_CREATABLE_ROLES.join(', ')}`),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .escape(),
  body('employeeCode')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .matches(/^[a-zA-Z0-9\-_]+$/)
    .withMessage('Employee code must be alphanumeric'),
  validate
];

const validateUserUpdate = [
  body('fullName')
    .if(body('fullName').exists())
    .trim()
    .isLength({ min: 2, max: 100 })
    .matches(/^[^\x00-\x08\x0B\x0C\x0E-\x1F]+$/),
  body('avatarUrl')
    .if(body('avatarUrl').exists())
    .custom((value) => {
      if (value === null || value === '') return true;
      if (typeof value !== 'string') throw new Error('avatarUrl must be a string');
      if (value.length > 3_600_000) throw new Error('avatarUrl is too large');
      if (/^https?:\/\//i.test(value)) return true;
      if (!/^data:image\/(png|jpe?g);base64,/i.test(value))
        throw new Error('Only PNG or JPEG images are allowed (data URL or http(s) link)');
      return true;
    }),
  body('role').if(body('role').exists()).isIn(VALID_ROLES),
  body('managerId').if(body('managerId').exists()).isUUID(),
  body('department')
    .if(body('department').exists())
    .trim()
    .isLength({ max: 100 })
    .escape(),
  body('employeeCode')
    .if(body('employeeCode').exists())
    .trim()
    .isLength({ max: 50 })
    .matches(/^[a-zA-Z0-9\-_]+$/)
    .withMessage('Employee code must be alphanumeric'),
  body('isActive').if(body('isActive').exists()).isBoolean(),
  validate
];

// ── Task validators ────────────────────────────────────────────────────────
const validateTaskCreate = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('Title must be 3-500 characters'),
  body('assignedTo')
    .optional()
    .custom((value) => {
      if (value === null || value === '' || value === undefined) return true;
      if (typeof value !== 'string') throw new Error('assignedTo must be a string');
      if (isUUID(value)) return true;
      throw new Error('assignedTo must be a valid UUID');
    }),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'critical']),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .escape(),
  body('dueDate')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (value == null || value === '') return true;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new Error('dueDate must be a valid date');
      return true;
    }),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 }),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 500 }),
  body('dependencyIds')
    .optional()
    .isArray({ max: 25 }).withMessage('dependencyIds must be an array'),
  body('dependencyIds.*')
    .optional()
    .custom((value) => {
      if (isUUID(String(value))) return true;
      throw new Error('Each dependency id must be a valid UUID');
    }),
  body('parentTaskId')
    .optional()
    .custom((value) => {
      if (value == null || value === '') return true;
      if (isUUID(String(value))) return true;
      throw new Error('parentTaskId must be a valid UUID');
    }),
  body('recurrence')
    .optional()
    .custom((value) => {
      if (value == null) return true;
      if (typeof value !== 'object' || Array.isArray(value)) throw new Error('recurrence must be an object');
      const allowedTypes = ['daily', 'weekly', 'monthly'];
      if (!allowedTypes.includes(value.type)) throw new Error('recurrence.type must be daily, weekly, or monthly');
      if (value.interval != null && (!Number.isInteger(value.interval) || value.interval < 1 || value.interval > 365))
        throw new Error('recurrence.interval must be an integer between 1 and 365');
      if (value.endsAt) {
        const d = new Date(value.endsAt);
        if (Number.isNaN(d.getTime())) throw new Error('recurrence.endsAt must be a valid date');
      }
      return true;
    }),
  body('approvalFlow')
    .optional()
    .isArray({ max: 8 }).withMessage('approvalFlow must be an array'),
  body('approvalFlow.*')
    .optional()
    .isIn(['employee', 'supervisor', 'manager', 'hr', 'director', 'admin'])
    .withMessage('approvalFlow contains an invalid role'),
  validate
];

const validateStatusUpdate = [
  body('status')
    .isIn(['pending','in_progress','submitted','ai_reviewing','ai_approved','ai_rejected',
           'manager_approved','manager_rejected','completed','overdue','cancelled'])
    .withMessage('Invalid status value'),
  body('note')
    .optional()
    .trim()
    .isLength({ max: 1000 }),
  validate
];

// ── Param validators ───────────────────────────────────────────────────────
const validateUUIDParam = (paramName = 'id') => [
  param(paramName).isUUID().withMessage(`${paramName} must be a valid UUID`),
  validate
];

// ── Pagination validators ──────────────────────────────────────────────────
const validatePagination = [
  query('page').optional().isInt({ min: 1, max: 10000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate
];

module.exports = {
  validate,
  validateLogin,
  validateChangePassword,
  validateUserCreate,
  validateManagerUserCreate,
  validateUserUpdate,
  validateTaskCreate,
  validateStatusUpdate,
  validateUUIDParam,
  validatePagination,
  VALID_ROLES,
  MANAGER_CREATABLE_ROLES,
};
