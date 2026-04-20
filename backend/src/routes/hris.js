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

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function canApproveForUser(managerId, targetUserId) {
  if (!managerId || !targetUserId) return false;
  const { rows } = await query(
    `SELECT 1 FROM get_subordinate_ids($1) WHERE user_id = $2 LIMIT 1`,
    [managerId, targetUserId]
  );
  return rows.length > 0;
}

// GET /hris/employees
router.get('/employees', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { page = 1, limit = 50, status, search, department } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * safeLimit;

    const params = [orgId];
    const conditions = ['e.org_id = $1'];
    let p = 2;

    // Org-wide roles see all employees, others see only their team
    if (!isOrgWideRole(req.user.role)) {
      try {
        const { rows: subRows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
        const ids = [req.user.id, ...subRows.map(r => r.user_id)];
        conditions.push(`(e.user_id = ANY($${p++}) OR e.user_id IS NULL)`);
        params.push(ids);
      } catch (fnErr) {
        // Fallback: function not available, show all org employees
        console.warn('get_subordinate_ids not available, showing all employees');
      }
    }

    if (status) { conditions.push(`e.status = $${p++}`); params.push(String(status)); }
    if (department) { conditions.push(`COALESCE(e.department,'') ILIKE $${p++}`); params.push(`%${department}%`); }
    if (search) {
      conditions.push(`(e.full_name ILIKE $${p} OR COALESCE(e.work_email,'') ILIKE $${p} OR COALESCE(e.title,'') ILIKE $${p})`);
      params.push(`%${String(search)}%`);
      p++;
    }

    const { rows } = await query(
      `SELECT
         e.*,
         u.email AS linked_user_email,
         m.full_name AS manager_name,
         COUNT(*) OVER() AS total_count
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users m ON m.id = e.manager_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.full_name ASC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, safeLimit, offset]
    );

    res.json({ employees: rows, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

// POST /hris/employees (admin/hr)
router.post('/employees', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    
    // Check subscription limits before allowing employee creation
    const { checkEmployeeAdditionLimit } = require('../services/subscriptionService');
    const subscriptionCheck = await checkEmployeeAdditionLimit(orgId);
    console.log('Subscription check result:', JSON.stringify(subscriptionCheck, null, 2));
    
    if (!subscriptionCheck.allowed) {
      console.log('SUBSCRIPTION CHECK FAILED - Returning 403');
      return res.status(403).json({ 
        error: subscriptionCheck.reason || 'Employee addition not allowed',
        subscription: {
          tier: subscriptionCheck.tier,
          limit: subscriptionCheck.limit,
          current: subscriptionCheck.current,
          remaining: subscriptionCheck.remaining
        }
      });
    } else {
      console.log('SUBSCRIPTION CHECK PASSED - Continuing with employee creation');
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
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND org_id = $2`,
      [workEmail, orgId]
    );
    
    if (existingUserRows.length > 0) {
      targetUserId = existingUserRows[0].id;
      
      // Check if employee record already exists for this user
      const { rows: existingEmpRows } = await query(
        `SELECT id FROM employees WHERE user_id = $1 AND org_id = $2`,
        [targetUserId, orgId]
      );
      
      if (existingEmpRows.length > 0) {
        return res.status(409).json({ 
          error: 'Employee record already exists for this user. Check the Employees page.',
          existingEmployeeId: existingEmpRows[0].id
        });
      }
      
      console.log(`Linking to existing user: ${workEmail}`);
    } else {
      // Create new user with auto-generated secure password
      const { v4: uuidv4 } = require('uuid');
      const { generateSecurePassword } = require('../services/employeeNotificationService');
      const bcrypt = require('bcryptjs');
      
      const tempPassword = generateSecurePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      
      const { rows: newUserRows } = await query(
        `INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, temp_password, temp_password_expires)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [uuidv4(), orgId, workEmail.toLowerCase(), hashedPassword, fullName, 'employee', true, new Date(), tempPassword, new Date(Date.now() + 24 * 60 * 60 * 1000)]
      );
      
      targetUserId = newUserRows[0].id;
      console.log(`Created new user with auto-generated password: ${workEmail}`);
    }

    // Create employee record
    const { rows } = await query(
      `INSERT INTO employees (org_id, user_id, full_name, title, department, manager_id, location, hire_date, work_email, phone_e164, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
       RETURNING *`,
      [orgId, targetUserId, fullName, title, department, managerId, location, hireDate, workEmail, phoneE164]
    );

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
    
    if (notificationResult.success) {
      console.log(`Welcome notification sent to employee: ${fullName}`);
    } else {
      console.log(`Failed to send welcome notification: ${notificationResult.error}`);
    }

    res.status(201).json({ 
      employee: rows[0],
      notificationSent: notificationResult.success,
      temporaryPassword: notificationResult.success ? notificationResult.tempPassword : null,
      tempPasswordExpires: notificationResult.success ? notificationResult.tempPasswordExpires : null,
      message: notificationResult.success 
        ? 'Employee created successfully. Welcome email sent with login credentials.'
        : 'Employee created successfully. Welcome email failed to send. See temporary password below.'
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
      const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
      const ids = [req.user.id, ...rows.map(r => r.user_id)];
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

