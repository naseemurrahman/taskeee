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
  employee: 10,
  technician: 15,
  supervisor: 20,
  manager: 30,
  hr: 40,
  director: 50,
  admin: 60,
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
