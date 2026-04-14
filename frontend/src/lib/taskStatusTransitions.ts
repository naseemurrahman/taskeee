/** Status values accepted by PATCH /tasks/:id/status (see validators.js). */
export const PATCH_VALID_STATUSES = [
  'pending',
  'in_progress',
  'submitted',
  'ai_reviewing',
  'ai_approved',
  'ai_rejected',
  'manager_approved',
  'manager_rejected',
  'completed',
  'overdue',
  'cancelled',
] as const

/**
 * Must stay in sync with `allowedTransitions` in `backend/src/routes/tasks.js`.
 * Use raw `task.status` (not board column key).
 */
const EMPLOYEE: Record<string, string[]> = {
  pending: ['in_progress'],
  overdue: ['in_progress'],
  in_progress: ['submitted', 'pending'],
  submitted: ['in_progress'],
  ai_reviewing: [],
  ai_approved: ['completed', 'in_progress'],
  ai_rejected: ['pending', 'in_progress'],
  completed: ['pending', 'in_progress'],
  manager_approved: ['completed'],
  manager_rejected: ['in_progress'],
  cancelled: ['pending'],
}

const SUPERVISOR_MANAGER: Record<string, string[]> = {
  pending: ['in_progress'],
  overdue: ['in_progress', 'completed', 'pending'],
  in_progress: ['submitted', 'completed', 'pending'],
  ai_reviewing: ['submitted', 'ai_approved', 'ai_rejected', 'completed'],
  ai_approved: ['completed', 'submitted'],
  ai_rejected: ['pending', 'in_progress', 'submitted'],
  submitted: ['manager_approved', 'manager_rejected', 'completed', 'ai_reviewing'],
  manager_approved: ['completed'],
  manager_rejected: ['pending', 'in_progress'],
  completed: ['pending', 'in_progress'],
  cancelled: ['pending'],
}

const MAPS: Record<string, Record<string, string[]>> = {
  employee: EMPLOYEE,
  supervisor: SUPERVISOR_MANAGER,
  manager: SUPERVISOR_MANAGER,
}

/**
 * Valid **next** statuses for PATCH /tasks/:id/status (used by Board + My Tasks).
 * Director/admin: all API-valid statuses (server skips transition rules).
 * HR: none (API returns 403 for HR on this route).
 */
export function getAllowedNextStatuses(role: string | undefined, fromStatus: string): string[] {
  const r = (role || 'employee') as string
  if (r === 'director' || r === 'admin') {
    return [...PATCH_VALID_STATUSES]
  }
  if (r === 'hr') {
    return []
  }
  const table = MAPS[r]
  if (!table) {
    return []
  }
  const next = table[fromStatus]
  if (next === undefined) {
    return []
  }
  return next
}

/** Manual status dropdown: current value plus allowed next steps. */
export function manualStatusOptionsForRole(role: string | undefined, currentStatus: string): string[] {
  if (role === 'director' || role === 'admin') {
    return [...PATCH_VALID_STATUSES]
  }
  const next = getAllowedNextStatuses(role, currentStatus)
  return Array.from(new Set([currentStatus, ...next]))
}
