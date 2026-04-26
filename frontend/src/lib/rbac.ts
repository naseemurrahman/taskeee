/**
 * rbac.ts – Role-Based Access Control helpers
 *
 * Roles in the system:
 *   admin    – full access
 *   manager  – can manage tasks, projects, approve
 *   hr       – can manage HR tasks and board
 *   employee – can only work their own tasks
 */

export type UserRole = 'admin' | 'manager' | 'hr' | 'employee' | string

/** Returns true if the role is a plain employee (not privileged). */
export function isEmployeeRole(role?: string | null): boolean {
  return role?.toLowerCase() === 'employee'
}

/**
 * Can the user create tasks and projects?
 * Admin, manager, and HR can create tasks.
 */
export function canCreateTasksAndProjects(role?: string | null): boolean {
  if (!role) return false
  return ['admin', 'manager', 'hr'].includes(role.toLowerCase())
}

/**
 * Can the user change task status (i.e. drag cards on the board)?
 *
 * FIX: admin, manager, and hr MUST return true here.
 * Employees can also drag their own tasks.
 * Only unauthenticated / unknown roles cannot drag.
 */
export function canChangeTaskStatus(role?: string | null): boolean {
  if (!role) return false
  return ['admin', 'manager', 'hr', 'employee'].includes(role.toLowerCase())
}

/** Can the user approve tasks (manager_approved status)? */
export function canApproveTask(role?: string | null): boolean {
  if (!role) return false
  return ['admin', 'manager'].includes(role.toLowerCase())
}

/** Can the user manage users / employees? */
export function canManageUsers(role?: string | null): boolean {
  if (!role) return false
  return ['admin', 'hr'].includes(role.toLowerCase())
}

/** Can the user access HR features? */
export function canAccessHR(role?: string | null): boolean {
  if (!role) return false
  return ['admin', 'hr'].includes(role.toLowerCase())
}

/** Can the user access admin settings? */
export function canAccessAdmin(role?: string | null): boolean {
  if (!role) return false
  return role.toLowerCase() === 'admin'
}
