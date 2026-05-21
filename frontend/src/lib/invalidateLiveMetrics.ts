import type { QueryClient } from '@tanstack/react-query'

/** Invalidate every React Query key used by live charts / KPIs across the app */
export function invalidateAllLiveMetrics(qc: QueryClient) {
  const prefixes = [
    'dashboard',
    'dashboard-live-',
    'analytics-',
    'insights',
    'insights-',
    'backend-ai-overview',
    'jeczone',
    'tasks',
    'board',
    'team',
    'projects',
    'reports',
    'hris',
    'crm',
    'billing',
    'dash-overdue',
  ]
  for (const prefix of prefixes) {
    qc.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey[0]
        return typeof key === 'string' && (key === prefix || key.startsWith(prefix))
      },
    })
  }
}
