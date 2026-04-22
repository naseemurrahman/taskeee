const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { canAddEmployee } = require('../services/subscriptionService');

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId != null && orgId !== '' ? String(orgId) : null;
}

let tableColumnsCache = new Map();

async function getTableColumns(tableName) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  try {
    let { rows } = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    // Some managed PG environments restrict information_schema visibility.
    // Fallback to pg_catalog to discover columns in those cases.
    if (!rows.length) {
      const fallback = await query(
        `SELECT a.attname AS column_name
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = $1
           AND a.attnum > 0
           AND NOT a.attisdropped`,
        [tableName]
      );
      rows = fallback.rows || [];
    }
    const set = new Set(rows.map((r) => String(r.column_name)));
    tableColumnsCache.set(tableName, set);
    return set;
  } catch (_err) {
    return new Set();
  }
}

function pickNameColumn(cols) {
  if (cols.has('full_name')) return 'full_name';
  if (cols.has('name')) return 'name';
  return null;
}

function pickOrgColumn(cols) {
  if (cols.has('org_id')) return 'org_id';
  if (cols.has('organization_id')) return 'organization_id';
  return null;
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function safeGetSubordinateIds(managerId) {
  if (!managerId) return [];
  try {
    const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [managerId]);
    return rows.map((r) => r.user_id).filter(Boolean);
  } catch (_err) {
    // Legacy DBs may not have get_subordinate_ids(). Fallback to self-only visibility.
    return [];
  }
}

async function canApproveForUser(managerId, targetUserId) {
  if (!managerId || !targetUserId) return false;
  const ids = await safeGetSubordinateIds(managerId);
  return ids.includes(targetUserId);
}

// GET /hris/employees
router.get('/employees', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const empCols = await getTableColumns('employees');
    const userCols = await getTableColumns('users');
    if (!empCols.size) return res.json({ employees: [], total: 0 });

    const orgCol = empCols.has('org_id') ? 'org_id' : (empCols.has('organization_id') ? 'organization_id' : null);
    if (!orgCol) return res.json({ employees: [], total: 0 });

    const { page = 1, limit = 50, status, search, department } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * safeLimit;

    const params = [orgId];
    const conditions = [`e.${orgCol} = $1`];
    let p = 2;

    if (!isOrgWideRole(req.user.role) && empCols.has('user_id')) {
      const subIds = await safeGetSubordinateIds(req.user.id);
      const ids = [req.user.id, ...subIds];
      conditions.push(`(e.user_id = ANY($${p++}) OR e.user_id IS NULL)`);
      params.push(ids);
    }

    if (status && empCols.has('status')) { conditions.push(`e.status = $${p++}`); params.push(String(status)); }
    if (department && empCols.has('department')) { conditions.push(`COALESCE(e.department,'') ILIKE $${p++}`); params.push(`%${department}%`); }
    if (search) {
      const searchParts = [];
      if (empCols.has('full_name')) searchParts.push(`e.full_name ILIKE $${p}`);
      if (empCols.has('work_email')) searchParts.push(`COALESCE(e.work_email,'') ILIKE $${p}`);
      if (empCols.has('title')) searchParts.push(`COALESCE(e.title,'') ILIKE $${p}`);
      if (searchParts.length) {
        conditions.push(`(${searchParts.join(' OR ')})`);
        params.push(`%${String(search)}%`);
        p++;
      }
    }

    const managerNameCol = pickNameColumn(userCols);
    const joinUser = empCols.has('user_id') && userCols.has('id');
    const joinManager = empCols.has('manager_id') && userCols.has('id') && !!managerNameCol;

    const selectCols = [
      ...(empCols.has('id') ? ['e.id'] : ['NULL::uuid AS id']),
      ...(empCols.has('full_name') ? ['e.full_name'] : ["''::text AS full_name"]),
      ...(empCols.has('status') ? ['e.status'] : ["'active'::text AS status"]),
      ...(empCols.has('title') ? ['e.title'] : ['NULL::text AS title']),
      ...(empCols.has('department') ? ['e.department'] : ['NULL::text AS department']),
      ...(empCols.has('work_email') ? ['e.work_email'] : ['NULL::text AS work_email']),
      ...(empCols.has('manager_id') ? ['e.manager_id'] : ['NULL::uuid AS manager_id']),
      ...(empCols.has('user_id') ? ['e.user_id'] : ['NULL::uuid AS user_id']),
      ...(joinUser && userCols.has('email') ? ['u.email AS linked_user_email'] : ['NULL::text AS linked_user_email']),
      ...(joinManager ? [`m.${managerNameCol} AS manager_name`] : ['NULL::text AS manager_name']),
      'COUNT(*) OVER() AS total_count',
    ];

    const orderCol = empCols.has('full_name') ? 'e.full_name' : (empCols.has('created_at') ? 'e.created_at' : 'e.id');

    const { rows } = await query(
      `SELECT ${selectCols.join(', ')}
       FROM employees e
       ${joinUser ? 'LEFT JOIN users u ON u.id = e.user_id' : ''}
       ${joinManager ? 'LEFT JOIN users m ON m.id = e.manager_id' : ''}
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderCol} ASC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, safeLimit, offset]
    );

    res.json({ employees: rows, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

// POST /hris/employees (admin/hr)
router.post('/employees', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const userCols = await getTableColumns('users');
    const empCols = await getTableColumns('employees');
    const userColsKnown = userCols.size > 0;
    const empColsKnown = empCols.size > 0;

    const userOrgCol = userColsKnown ? pickOrgColumn(userCols) : 'org_id';
    const empOrgCol = empColsKnown ? pickOrgColumn(empCols) : 'org_id';
    const userNameCol = userColsKnown ? pickNameColumn(userCols) : 'full_name';
    if (!userOrgCol || !empOrgCol) return res.status(500).json({ error: 'Organization fields are missing in required tables.' });
    if (userColsKnown && !userCols.has('email')) return res.status(500).json({ error: 'users.email column is required.' });

    // Check subscription limits before allowing employee creation
    const { checkEmployeeAdditionLimit } = require('../services/subscriptionService');
    const subscriptionCheck = await checkEmployeeAdditionLimit(orgId);

    if (!subscriptionCheck.allowed) {
      return res.status(403).json({ 
        error: subscriptionCheck.reason || 'Employee addition not allowed',
        subscription: {
          tier: subscriptionCheck.tier,
          limit: subscriptionCheck.limit,
          current: subscriptionCheck.current,
          remaining: subscriptionCheck.remaining
        }
      });
    }

    const fullName = String(req.body?.fullName || req.body?.full_name || '').trim();
    const title = String(req.body?.title || '').trim() || null;
    const department = String(req.body?.department || '').trim() || null;
    const location = String(req.body?.location || '').trim() || null;
    const workEmail = String(req.body?.workEmail || req.body?.work_email || req.body?.email || '').trim() || null;
    const phoneE164 = String(req.body?.phoneE164 || req.body?.phone_e164 || req.body?.phone || '').trim() || null;
    const userId = req.body?.userId || req.body?.user_id || null;
    const managerId = req.body?.managerId || req.body?.manager_id || null;
    const hireDate = parseDateOnly(req.body?.hireDate || req.body?.hire_date);

    if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'fullName is required (minimum 2 characters)' });
    if (!workEmail) return res.status(400).json({ error: 'Email is required' });

    // Check if user already exists with this email
    let targetUserId = userId;
    const { rows: existingUserRows } = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND ${userOrgCol} = $2`,
      [workEmail, orgId]
    );
    
    if (existingUserRows.length > 0) {
      targetUserId = existingUserRows[0].id;
      
      // Check if employee record already exists for this user
      let existingEmpRows = [];
      if (!empColsKnown || empCols.has('user_id')) {
        try {
          ({ rows: existingEmpRows } = await query(
            `SELECT id FROM employees WHERE user_id = $1 AND ${empOrgCol} = $2`,
            [targetUserId, orgId]
          ));
        } catch (empCheckErr) {
          // If employees table does not exist, continue with user-only onboarding.
          if (empCheckErr.code !== '42P01') throw empCheckErr;
        }
      }
      
      if (existingEmpRows.length > 0) {
        return res.status(409).json({ 
          error: 'Employee record already exists for this user. Check the Employees page.',
          existingEmployeeId: existingEmpRows[0].id
        });
      }
    } else {
      // Create new user with auto-generated secure password
      const { v4: uuidv4 } = require('uuid');
      const { generateSecurePassword } = require('../services/employeeNotificationService');
      const bcrypt = require('bcryptjs');
      
      const tempPassword = generateSecurePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const newUserId = uuidv4();
      const fields = ['id', userOrgCol, 'email'];
      const values = [newUserId, orgId, workEmail.toLowerCase()];

      if (!userColsKnown || userCols.has('password_hash')) {
        fields.push('password_hash');
        values.push(hashedPassword);
      }
      if (userNameCol) {
        fields.push(userNameCol);
        values.push(fullName);
      }
      if (!userColsKnown || userCols.has('role')) {
        fields.push('role');
        values.push('employee');
      }
      if (!userColsKnown || userCols.has('is_active')) {
        fields.push('is_active');
        values.push(true);
      }
      if (!userColsKnown || userCols.has('created_at')) {
        fields.push('created_at');
        values.push(new Date());
      }
      if (!userColsKnown || userCols.has('temp_password')) {
        fields.push('temp_password');
        values.push(tempPassword);
      }
      if (!userColsKnown || userCols.has('temp_password_expires')) {
        fields.push('temp_password_expires');
        values.push(new Date(Date.now() + 24 * 60 * 60 * 1000));
      }

      const placeholders = fields.map((_, idx) => `$${idx + 1}`).join(', ');
      const { rows: newUserRows } = await query(
        `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        values
      );
      
      targetUserId = newUserRows[0].id;
    }

    // Create employee record
    const empFields = [empOrgCol];
    const empValues = [orgId];

    if (!empColsKnown || empCols.has('user_id')) { empFields.push('user_id'); empValues.push(targetUserId); }
    if (!empColsKnown || empCols.has('full_name')) { empFields.push('full_name'); empValues.push(fullName); }
    else if (empCols.has('name')) { empFields.push('name'); empValues.push(fullName); }
    if (!empColsKnown || empCols.has('title')) { empFields.push('title'); empValues.push(title); }
    if (!empColsKnown || empCols.has('department')) { empFields.push('department'); empValues.push(department); }
    if (!empColsKnown || empCols.has('manager_id')) { empFields.push('manager_id'); empValues.push(managerId); }
    if (!empColsKnown || empCols.has('location')) { empFields.push('location'); empValues.push(location); }
    if (!empColsKnown || empCols.has('hire_date')) { empFields.push('hire_date'); empValues.push(hireDate); }
    if (!empColsKnown || empCols.has('work_email')) { empFields.push('work_email'); empValues.push(workEmail); }
    if (!empColsKnown || empCols.has('phone_e164')) { empFields.push('phone_e164'); empValues.push(phoneE164); }
    if (!empColsKnown || empCols.has('status')) { empFields.push('status'); empValues.push('active'); }

    const empPlaceholders = empFields.map((_, idx) => `$${idx + 1}`).join(', ');
    let rows = [];
    let employeeRecordCreated = true;
    try {
      ({ rows } = await query(
        `INSERT INTO employees (${empFields.join(', ')}) VALUES (${empPlaceholders}) RETURNING *`,
        empValues
      ));
    } catch (empInsertErr) {
      // Legacy deployments may not have employees table yet.
      if (empInsertErr.code !== '42P01') throw empInsertErr;
      employeeRecordCreated = false;
      rows = [{
        id: null,
        user_id: targetUserId,
        full_name: fullName,
        work_email: workEmail,
        status: 'active'
      }];
    }

    if (!rows.length) return res.status(500).json({ error: 'Could not create employee record.' });

    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || null;
    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'hris.employee.create',
      entityType: 'employee',
      entityId: rows[0]?.id || null,
      metadata: { fullName, workEmail, userId: targetUserId },
      ip,
      userAgent
    });

    // Send welcome notification to new employee
    const { sendEmployeeWelcomeNotification } = require('../services/employeeNotificationService');
    const employee = {
      id: rows[0]?.id,
      full_name: fullName,
      work_email: workEmail,
      phone_e164: phoneE164,
      user_id: targetUserId
    };
    
    const notificationResult = await sendEmployeeWelcomeNotification(employee, orgId);

    res.status(201).json({ 
      employee: rows[0],
      employeeRecordCreated,
      notificationSent: notificationResult.success,
      temporaryPassword: notificationResult.success ? notificationResult.tempPassword : null,
      tempPasswordExpires: notificationResult.success ? notificationResult.tempPasswordExpires : null,
      message: notificationResult.success
        ? (employeeRecordCreated
          ? 'Employee created successfully. Welcome email sent with login credentials.'
          : 'User created and onboarded successfully. Employee table is unavailable, so only user profile was created.')
        : (employeeRecordCreated
          ? 'Employee created successfully. Welcome email failed to send. See temporary password below.'
          : 'User created successfully but employee table is unavailable and welcome email failed. See temporary password below.')
    });
  } catch (err) { 
    if (err.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ error: 'Employee with this email already exists.' });
    }
    next(err); 
  }
});

// GET /hris/employees/:id
router.get('/employees/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const empId = req.params.id;
    const { rows } = await query(
      `SELECT e.*, u.email AS linked_user_email, m.full_name AS manager_name
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users m ON m.id = e.manager_id
       WHERE e.id = $1 AND e.org_id = $2`,
      [empId, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });

    const employee = rows[0];
    if (!isOrgWideRole(req.user.role)) {
      // allow self (linked user) or subtree
      if (employee.user_id && employee.user_id === req.user.id) return res.json({ employee });
      if (employee.user_id && await canApproveForUser(req.user.id, employee.user_id)) return res.json({ employee });
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ employee });
  } catch (err) { next(err); }
});

// PATCH /hris/employees/:id
router.patch('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const empId = req.params.id;

    const allowed = ['status', 'full_name', 'title', 'department', 'location', 'hire_date', 'work_email', 'phone_e164', 'manager_id'];
    const body = req.body || {};
    const map = {
      status: body.status,
      full_name: body.fullName ?? body.full_name,
      title: body.title,
      department: body.department,
      location: body.location,
      hire_date: body.hireDate ?? body.hire_date,
      work_email: body.workEmail ?? body.work_email,
      phone_e164: body.phoneE164 ?? body.phone_e164,
      manager_id: body.managerId ?? body.manager_id,
    };

    const updates = [];
    const params = [];
    let p = 1;
    for (const k of allowed) {
      if (map[k] !== undefined) {
        let v = map[k];
        if (k === 'hire_date') v = parseDateOnly(v);
        if (typeof v === 'string') v = v.trim();
        updates.push(`${k} = $${p++}`);
        params.push(v === '' ? null : v);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(empId, orgId);
    const { rows } = await query(
      `UPDATE employees SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${p++} AND org_id = $${p}
       RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'hris.employee.update',
      entityType: 'employee',
      entityId: rows[0]?.id || null,
      metadata: { fields: updates.map(x => x.split('=')[0].trim()) },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.json({ employee: rows[0] });
  } catch (err) { next(err); }
});

// POST /hris/time-off/requests

// DELETE /hris/employees/:id — hard delete employee + deactivate user (admin/hr only)
router.delete('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const { id } = req.params;

    // Find the employee record first
    const { rows: empRows } = await query(
      `SELECT e.*, u.role FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 AND e.org_id = $2`,
      [id, orgId]
    );
    if (!empRows.length) return res.status(404).json({ error: 'Employee not found' });

    const emp = empRows[0];
    // Safety: cannot delete admin users
    if (emp.role === 'admin') return res.status(403).json({ error: 'Cannot delete an admin user.' });

    // Soft-delete: deactivate user account + delete HRIS employee record
    if (emp.user_id) {
      await query(
        `UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id = $2`,
        [emp.user_id, orgId]
      );
    }
    await query(`DELETE FROM employees WHERE id = $1 AND org_id = $2`, [id, orgId]);

    res.json({ success: true, message: 'Employee deleted and account deactivated.' });
  } catch (err) { next(err); }
});

// DELETE /hris/employees — delete ALL non-admin employees in org (admin only)
router.delete('/employees', authenticate, requireAnyRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;

    // Deactivate all non-admin users except current user
    await query(
      `UPDATE users SET is_active = FALSE
       WHERE org_id = $1 AND role != 'admin' AND id != $2`,
      [orgId, req.user.id]
    );
    // Delete all HRIS employee records in this org
    const { rowCount } = await query(
      `DELETE FROM employees WHERE org_id = $1`,
      [orgId]
    );

    res.json({ success: true, deleted: rowCount, message: `Deleted ${rowCount} employee records.` });
  } catch (err) { next(err); }
});

router.post('/time-off/requests', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const startDate = parseDateOnly(req.body?.startDate || req.body?.start_date);
    const endDate = parseDateOnly(req.body?.endDate || req.body?.end_date);
    const reason = String(req.body?.reason || '').trim() || null;

    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const { rows: empRows } = await query(
      `SELECT id FROM employees WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, req.user.id]
    );
    if (!empRows.length) return res.status(400).json({ error: 'No employee profile linked to this user' });

    const { rows } = await query(
      `INSERT INTO time_off_requests (org_id, employee_id, start_date, end_date, reason, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [orgId, empRows[0].id, startDate, endDate, reason, req.user.id]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'hris.time_off.request',
      entityType: 'time_off_request',
      entityId: rows[0]?.id || null,
      metadata: { startDate, endDate },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.status(201).json({ request: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /hris/time-off/requests/:id  { status: approved|rejected|cancelled }
router.patch('/time-off/requests/:id', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const id = req.params.id;
    const status = String(req.body?.status || '').trim();
    if (!['approved', 'rejected', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const { rows: existingRows } = await query(
      `SELECT r.*, e.user_id AS employee_user_id
       FROM time_off_requests r
       JOIN employees e ON e.id = r.employee_id
       WHERE r.id = $1 AND r.org_id = $2`,
      [id, orgId]
    );
    if (!existingRows.length) return res.status(404).json({ error: 'Request not found' });
    const existing = existingRows[0];

    const isPrivileged = isOrgWideRole(req.user.role);
    const isSelf = existing.requested_by && existing.requested_by === req.user.id;
    const canManage = existing.employee_user_id ? await canApproveForUser(req.user.id, existing.employee_user_id) : false;

    if (status === 'cancelled') {
      if (!isSelf && !isPrivileged) return res.status(403).json({ error: 'Access denied' });
    } else {
      if (!isPrivileged && !canManage) return res.status(403).json({ error: 'Access denied' });
    }

    const decidedBy = (status === 'approved' || status === 'rejected') ? req.user.id : null;
    const decidedAt = (status === 'approved' || status === 'rejected') ? 'NOW()' : 'NULL';

    const { rows } = await query(
      `UPDATE time_off_requests
       SET status = $1,
           decided_by = $2,
           decided_at = ${decidedAt},
           updated_at = NOW()
       WHERE id = $3 AND org_id = $4
       RETURNING *`,
      [status, decidedBy, id, orgId]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'hris.time_off.update',
      entityType: 'time_off_request',
      entityId: id,
      metadata: { status },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.json({ request: rows[0] });
  } catch (err) { next(err); }
});

// GET /hris/time-off/requests
router.get('/time-off/requests', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { status } = req.query;

    const params = [orgId];
    const conditions = ['r.org_id = $1'];
    let p = 2;

    if (status) { conditions.push(`r.status = $${p++}`); params.push(String(status)); }

    if (!isOrgWideRole(req.user.role)) {
      const subIds = await safeGetSubordinateIds(req.user.id);
      const ids = [req.user.id, ...subIds];
      conditions.push(`e.user_id = ANY($${p++})`);
      params.push(ids);
    }

    const { rows } = await query(
      `SELECT r.*, e.full_name AS employee_name, e.user_id AS employee_user_id
       FROM time_off_requests r
       JOIN employees e ON e.id = r.employee_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params
    );
    res.json({ requests: rows });
  } catch (err) { next(err); }
});

module.exports = router;
