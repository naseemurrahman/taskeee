/** Roles allowed to create tasks / projects and assign work in the app shell. */
export const ROLES_CREATE_AND_ASSIGN_WORK = ['manager', 'hr', 'director', 'admin'] as const

export function canCreateTasksAndProjects(role: string | undefined): boolean {
  return !!role && (ROLES_CREATE_AND_ASSIGN_WORK as readonly string[]).includes(role)
}
