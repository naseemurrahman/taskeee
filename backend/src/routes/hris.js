const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { canAddEmployee } = require('../services/subscriptionService');
const emailService = require('../services/emailService');

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
    const title = String(req.body?.title || req.body?.designation || '').trim() || null;
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
        const allowedRoles = ['employee', 'manager', 'hr', 'supervisor', 'director', 'technician', 'admin'];
        const requestedRole = String(req.body?.role || 'employee').toLowerCase();
        // Only admin can create admin/director users
        const roleToAssign = allowedRoles.includes(requestedRole) ? requestedRole : 'employee';
        const protectedRoles = ['admin', 'director'];
        const finalRole = protectedRoles.includes(roleToAssign) && !['admin', 'director'].includes(req.user.role)
          ? 'employee'
          : roleToAssign;
        fields.push('role');
        values.push(finalRole);
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

    const employee = {
      id: rows[0]?.id,
      full_name: fullName,
      work_email: workEmail,
      phone_e164: phoneE164,
      user_id: targetUserId,
    };

    // ── Respond immediately — do NOT await email or audit ──────────────────
    // These were the sole cause of the "Request timed out" error:
    //   • bcrypt already ran above (unavoidable, kept there)
    //   • sendEmployeeWelcomeNotification hits SMTP (5-30s depending on provider)
    //   • logAudit hits DB (fast but still adds latency)
    // Respond to the client now, then run side-effects in the background.
    res.status(201).json({
      employee: rows[0],
      employeeRecordCreated,
      notificationSent: null,
      temporaryPassword: tempPassword,  // shown once in the UI for admin to share
      tempPasswordExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      loginEmail: normalizedEmail,
      message: employeeRecordCreated
        ? 'Employee created successfully. Save the temporary password shown — it will not be shown again.'
        : 'User created and onboarded successfully.',
    });

    // ── Background: audit log + welcome email (non-blocking) ──────────────
    ;(async () => {
      try {
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
          userAgent,
        });
      } catch (auditErr) {
        console.warn('[HRIS] Audit log failed (non-critical):', auditErr?.message);
      }

      try {
        const { sendEmployeeWelcomeNotification } = require('../services/employeeNotificationService');
        await sendEmployeeWelcomeNotification(employee, orgId);
      } catch (emailErr) {
        console.warn('[HRIS] Welcome email failed (non-critical):', emailErr?.message);
      }
    })();
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

    // Specific log for status changes
    if (body.status) {
      try {
        await logUserActivity({
          orgId,
          userId: req.user.id,
          activityType: 'employee_status_changed',
          metadata: { employeeId: rows[0]?.id, employeeName: rows[0]?.full_name, newStatus: body.status },
        });
      } catch { /* non-critical */ }
    }

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: body.status ? `hris.employee.status.${body.status}` : 'hris.employee.update',
      entityType: 'employee',
      entityId: rows[0]?.id || null,
      metadata: { fields: updates.map(x => x.split('=')[0].trim()), newStatus: body.status || undefined, employeeName: rows[0]?.full_name },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    // Fix 6/7: Sync user account active state and quarantine tasks on status change
    if (body.status) {
      const emp = rows[0];
      const isActive = body.status === 'active';
      const nonActiveStatuses = ['inactive', 'terminated', 'suspended', 'on_leave'];
      const isNonActive = nonActiveStatuses.includes(body.status);

      // Deactivate / reactivate the linked user account (blocks login per auth.js is_active check)
      if (emp?.user_id) {
        try {
          await query(
            `UPDATE users SET is_active = $1 WHERE id = $2 AND org_id = $3`,
            [isActive, emp.user_id, orgId]
          );
        } catch { /* non-critical */ }
      }

      // When deactivated: put all assigned tasks on_hold so they appear in a quarantine state
      // When reactivated: restore on_hold tasks to pending
      if (isNonActive && emp?.user_id) {
        try {
          await query(
            `UPDATE tasks SET status = 'on_hold'
             WHERE org_id = $1 AND assigned_to = $2
             AND status NOT IN ('completed','manager_approved','cancelled','on_hold')
             AND deleted_at IS NULL`,
            [orgId, emp.user_id]
          );
        } catch { /* non-critical */ }
      } else if (isActive && emp?.user_id) {
        try {
          await query(
            `UPDATE tasks SET status = 'pending'
             WHERE org_id = $1 AND assigned_to = $2
             AND status = 'on_hold'
             AND deleted_at IS NULL`,
            [orgId, emp.user_id]
          );
        } catch { /* non-critical */ }
      }
    }

    res.json({ employee: rows[0] });
  } catch (err) { next(err); }
});

// POST /hris/time-off/requests

// GET /hris/employees/:id/active-tasks — fetch active tasks for an employee (for terminate popup)
router.get('/employees/:id/active-tasks', authenticate, requireAnyRole('hr', 'director', 'admin', 'manager'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const { id } = req.params;
    const { rows: empRows } = await query(`SELECT user_id FROM employees WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (!empRows.length) return res.json({ tasks: [] });
    const userId = empRows[0].user_id;
    if (!userId) return res.json({ tasks: [] });

    const { rows } = await query(
      `SELECT t.id, t.title, COALESCE(t.status,'pending') AS status, t.priority, t.due_date,
              COALESCE(cat.name, proj.name) AS project_name
         FROM tasks t
         LEFT JOIN task_categories cat ON cat.id = t.category_id
         LEFT JOIN projects proj ON proj.id = t.project_id
        WHERE t.org_id = $1
          AND t.assigned_to = $2
          AND COALESCE(t.status,'pending') NOT IN ('completed','manager_approved','cancelled')
          AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 50`,
      [orgId, userId]
    );
    res.json({ tasks: rows });
  } catch (err) { next(err); }
});

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

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'employee_terminated', metadata: { employeeId: id, employeeName: emp.full_name } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'hris.employee.terminated', entityType: 'employee', entityId: id, metadata: { employeeName: emp.full_name }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

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

    // ── Email notification to the requester ─────────────────────────────────
    if (status === 'approved' || status === 'rejected') {
      try {
        // Get requester email + name
        const { rows: userRows } = await query(
          `SELECT u.email, u.full_name, e.full_name AS emp_name
           FROM users u
           LEFT JOIN employees e ON e.user_id = u.id AND e.org_id = $2
           WHERE u.id = $1`,
          [existing.requested_by || existing.employee_user_id, orgId]
        );
        if (userRows.length && userRows[0].email) {
          const recipient = userRows[0];
          const name = recipient.emp_name || recipient.full_name || 'Team Member';
          const approverName = req.user.name || req.user.full_name || 'Your manager';
          const isApproved = status === 'approved';
          const startFmt = new Date(existing.start_date).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
          const endFmt   = new Date(existing.end_date).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
          const accentColor = isApproved ? '#22c55e' : '#ef4444';
          const icon = isApproved ? '✅' : '❌';

          const html = `
            <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">
              <div style="padding:28px 32px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:3px solid ${accentColor}">
                <div style="font-size:28px;margin-bottom:6px">${icon}</div>
                <h1 style="margin:0;font-size:22px;font-weight:900;color:#f1f5f9">Time-Off Request ${isApproved ? 'Approved' : 'Rejected'}</h1>
              </div>
              <div style="padding:28px 32px;color:#cbd5e1">
                <p style="margin:0 0 16px">Hi <strong style="color:#f1f5f9">${name}</strong>,</p>
                <p style="margin:0 0 16px">Your time-off request has been <strong style="color:${accentColor}">${status}</strong> by <strong style="color:#f1f5f9">${approverName}</strong>.</p>
                <div style="background:#1e293b;border-radius:12px;padding:16px 20px;margin:20px 0;border:1px solid rgba(255,255,255,0.08)">
                  <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                    <span style="color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">FROM</span>
                    <span style="color:#f1f5f9;font-weight:700">${startFmt}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                    <span style="color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">TO</span>
                    <span style="color:#f1f5f9;font-weight:700">${endFmt}</span>
                  </div>
                  ${existing.reason ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08)"><span style="color:#94a3b8;font-size:12px">Reason: </span><span style="color:#cbd5e1">${existing.reason}</span></div>` : ''}
                </div>
                ${!isApproved ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:13px">If you have questions about this decision, please speak with your manager directly.</p>` : ''}
              </div>
              <div style="padding:16px 32px;background:#1e293b;border-top:1px solid rgba(255,255,255,0.06)">
                <p style="margin:0;font-size:12px;color:#475569">This is an automated notification from TASKEE.</p>
              </div>
            </div>`;

          await emailService.sendEmail(
            userRows[0].email,
            `${icon} Time-Off ${isApproved ? 'Approved' : 'Rejected'} — ${startFmt} to ${endFmt}`,
            html
          );
        }
      } catch (emailErr) {
        console.warn('[hris] leave email notification failed (non-fatal):', emailErr.message);
      }
    }

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
