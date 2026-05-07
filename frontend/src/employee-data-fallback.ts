/*
 * Employee-scoped data fallback.
 *
 * Some operational pages are shared between managers and employees. Manager/admin
 * endpoints may legitimately return 403 or fail on legacy tables, but employee
 * screens should not show hard "failed to load data" banners for optional panels.
 * This wrapper converts optional employee-only failures into empty, valid payloads.
 * Core task/profile endpoints are intentionally not masked.
 */

function getStoredUserRole(): string {
  try {
    const candidates = [
      localStorage.getItem('user'),
      localStorage.getItem('tf_user'),
      localStorage.getItem('taskflow_user'),
      sessionStorage.getItem('user'),
      sessionStorage.getItem('tf_user'),
    ].filter(Boolean) as string[]

    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw)
        const role = parsed?.role || parsed?.user?.role
        if (role) return String(role).toLowerCase()
      } catch {
        // Continue with the next storage key.
      }
    }
  } catch {
    // Storage may be unavailable in private mode.
  }
  return ''
}

function isEmployeeSession(): boolean {
  const role = getStoredUserRole()
  return role === 'employee' || role === 'technician'
}

function fallbackForUrl(url: string): unknown | null {
  if (!isEmployeeSession()) return null
  let path = ''
  try {
    path = new URL(url, window.location.origin).pathname
  } catch {
    path = String(url || '')
  }

  if (path.endsWith('/api/v1/projects')) return { projects: [], meta: { scope: 'assigned_projects_only', role: getStoredUserRole(), fallback: true } }
  if (path.endsWith('/api/v1/performance/summary')) {
    return {
      scope: 'self',
      totalTasks: 0,
      byStatus: {},
      userCount: 1,
      byAssignee: {},
      assigneeLeaderboard: [],
      workload: { averageOpenTasks: 0, overloaded: [], underutilized: [] },
      teamPerformanceScore: 0,
      fallback: true,
    }
  }
  if (path.endsWith('/api/v1/performance/activity')) return { activities: [], fallback: true }
  if (path.endsWith('/api/v1/analytics/workload')) return { employees: [], fallback: true }
  if (path.endsWith('/api/v1/contractors')) return { contractors: [], total: 0, fallback: true }
  if (path.endsWith('/api/v1/hris/time-off/requests')) return { requests: [], fallback: true }
  return null
}

export function installEmployeeDataFallback() {
  if (typeof window === 'undefined') return
  const marker = '__taskeeEmployeeDataFallbackInstalled'
  const anyWindow = window as typeof window & Record<string, unknown>
  if (anyWindow[marker]) return
  anyWindow[marker] = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    if (response.ok) return response

    const method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
    if (method !== 'GET') return response

    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const fallback = fallbackForUrl(url)
    if (!fallback) return response

    return new Response(JSON.stringify(fallback), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json', 'X-Taskee-Fallback': 'employee-data' },
    })
  }
}
