export type UserRole =
  | 'employee'
  | 'technician'
  | 'supervisor'
  | 'manager'
  | 'hr'
  | 'director'
  | 'admin'
  | string

const ROLE_RANK: Record<string, number> = {
  employee: 10, technician: 15, supervisor: 20,
  manager: 30, hr: 40, director: 50, admin: 60,
}

/** All task status transitions. Mirror of backend/src/utils/permissions.js */
export const TASK_TRANSITIONS: Record<string, Record<string, string[] | '*'>> = {
  pending:          { employee: ['in_progress'], supervisor: ['in_progress','cancelled'], manager: ['in_progress','cancelled'], hr: ['in_progress','cancelled','completed'], director: '*', admin: '*' },
  in_progress:      { employee: ['submitted'], supervisor: ['submitted','completed','cancelled'], manager: ['submitted','completed','cancelled'], hr: ['submitted','completed','cancelled'], director: '*', admin: '*' },
  submitted:        { employee: [], supervisor: ['ai_reviewing','manager_approved','manager_rejected','in_progress'], manager: ['manager_approved','manager_rejected','in_progress'], hr: ['manager_approved','manager_rejected'], director: '*', admin: '*' },
  ai_reviewing:     { employee: [], supervisor: ['manager_approved','manager_rejected'], manager: ['manager_approved','manager_rejected'], hr: ['manager_approved','manager_rejected'], director: '*', admin: '*' },
  ai_approved:      { employee: [], supervisor: ['manager_approved','manager_rejected'], manager: ['manager_approved','manager_rejected'], hr: ['manager_approved'], director: '*', admin: '*' },
  ai_rejected:      { employee: ['in_progress'], supervisor: ['in_progress','submitted'], manager: ['in_progress','submitted'], hr: ['in_progress'], director: '*', admin: '*' },
  manager_approved: { employee: ['completed'], supervisor: ['completed'], manager: ['completed'], hr: ['completed'], director: '*', admin: '*' },
  manager_rejected: { employee: ['in_progress'], supervisor: ['in_progress'], manager: ['in_progress'], hr: ['in_progress'], director: '*', admin: '*' },
  completed:        { employee: [], supervisor: [], manager: ['in_progress'], hr: ['in_progress'], director: '*', admin: '*' },
  overdue:          { employee: ['in_progress'], supervisor: ['in_progress','cancelled'], manager: ['in_progress','cancelled'], hr: ['in_progress','cancelled'], director: '*', admin: '*' },
  cancelled:        { employee: [], supervisor: [], manager: ['pending'], hr: ['pending'], director: '*', admin: '*' },
}

function normalizeRole(role?: string | null): string {
  return String(role || '').trim().toLowerCase()
}

function rank(role?: string | null): number {
  return ROLE_RANK[normalizeRole(role)] ?? 0
}

export function isEmployeeRole(role?: string | null): boolean {
  return ['employee', 'technician'].includes(normalizeRole(role))
}

export function canCreateTasksAndProjects(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.supervisor
}

export function canChangeTaskStatus(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.supervisor
}

export function canApproveTask(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.manager
}

export function canManageUsers(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.hr
}

export function canAccessHR(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.hr
}

export function canAccessAdmin(role?: string | null): boolean {
  return normalizeRole(role) === 'admin'
}

export function canViewAnalytics(role?: string | null): boolean {
  return rank(role) >= ROLE_RANK.manager
}

/** Get the allowed next statuses for a task transition */
export function getAllowedTransitions(fromStatus: string, role?: string | null): string[] {
  const norm = normalizeRole(role)
  const map = TASK_TRANSITIONS[fromStatus]
  if (!map) return []
  const allowed = map[norm] ?? []
  if (allowed === '*') return Object.keys(TASK_TRANSITIONS)
  return allowed as string[]
}

export function canTransition(fromStatus: string, toStatus: string, role?: string | null): boolean {
  const allowed = getAllowedTransitions(fromStatus, role)
  return allowed.includes(toStatus)
}

/** Check a named permission (matches backend PERMISSIONS matrix) */
const PERMISSION_MIN_ROLE: Record<string, string> = {
  'task.create': 'supervisor',
  'task.read.org': 'hr',
  'task.update.any': 'supervisor',
  'task.delete': 'manager',
  'task.assign': 'supervisor',
  'task.bulk_assign': 'supervisor',
  'task.approve': 'manager',
  'task.override_status': 'director',
  'analytics.team': 'manager',
  'analytics.org': 'hr',
  'user.create': 'hr',
  'user.update.any': 'hr',
  'user.delete': 'admin',
  'report.generate': 'manager',
  'report.read.org': 'hr',
  'project.create': 'supervisor',
  'project.delete': 'manager',
  'timeoff.approve': 'manager',
  'timeoff.read.org': 'hr',
  'ai.recommendations': 'manager',
  'admin.settings': 'admin',
  'admin.billing': 'admin',
  'admin.audit': 'hr',
}

export function hasPermission(role: string | null | undefined, permission: string): boolean {
  const minRole = PERMISSION_MIN_ROLE[permission]
  if (!minRole) return false
  return rank(role) >= rank(minRole)
}

