/** Role hierarchy — higher index = more authority */
export const ROLE_ORDER = ['employee', 'supervisor', 'manager', 'hr', 'director', 'admin'] as const
export type AppRole = typeof ROLE_ORDER[number]

function rankOf(role: string | undefined): number {
  return ROLE_ORDER.indexOf((role || 'employee') as AppRole)
}

/** Roles allowed to create tasks / projects and assign work */
export const ROLES_CREATE_AND_ASSIGN_WORK = ['supervisor', 'manager', 'hr', 'director', 'admin'] as const

export function canCreateTasksAndProjects(role: string | undefined): boolean {
  return !!role && (ROLES_CREATE_AND_ASSIGN_WORK as readonly string[]).includes(role)
}

/** Can change the status of a task (employees CANNOT change status in the Tasks table) */
export function canChangeTaskStatus(role: string | undefined): boolean {
  return rankOf(role) >= rankOf('supervisor')
}

/** Can rename tasks/projects */
export function canRenameTasksAndProjects(role: string | undefined): boolean {
  return rankOf(role) >= rankOf('supervisor')
}

/** Is this role strictly an employee (no management capabilities) */
export function isEmployeeRole(role: string | undefined): boolean {
  return !role || role === 'employee'
}

/** Can see all org employees / HR data */
export function canViewHR(role: string | undefined): boolean {
  return rankOf(role) >= rankOf('hr')
}

/** Can manage employees (add/delete) */
export function canManageEmployees(role: string | undefined): boolean {
  return rankOf(role) >= rankOf('hr')
}

/** Can see analytics and reports */
export function canViewAnalytics(role: string | undefined): boolean {
  return rankOf(role) >= rankOf('manager')
}
