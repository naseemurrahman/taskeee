import { apiFetch } from './api'

export type AnalyticsSummary = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  overdue_tasks: number
  active_employees: number
  avg_completion_hours: string | number
  avg_ai_confidence: string | number
}

export type StatusPoint = { status: string; count: number }
export type TrendPoint = { day: string; created?: number; completed?: number; overdue?: number }
export type EmployeePerformance = {
  employee_id: string
  employee_name: string
  assigned: number
  completed: number
  overdue: number
}

function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') s.set(key, String(value))
  })
  return s.toString()
}

export async function fetchAnalyticsSummary(days: number) {
  return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?${qs({ days })}`)
}

export async function fetchAnalyticsTaskStatus(days: number) {
  return apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?${qs({ days })}`)
}

export async function fetchAnalyticsTasksOverTime(days: number) {
  return apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?${qs({ days })}`)
}

export async function fetchAnalyticsEmployeePerformance(days: number) {
  return apiFetch<{ employees: EmployeePerformance[] }>(`/api/v1/analytics/employee-performance?${qs({ days })}`)
}

export async function fetchAnalyticsWorkload(days: number) {
  return apiFetch<{ employees: Array<{ employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }> }>(`/api/v1/analytics/workload?${qs({ days })}`)
}

export async function fetchAnalyticsAiValidation(days: number) {
  return apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/ai-validation?${qs({ days })}`)
}

export async function fetchAnalyticsAiConfidence(days: number) {
  return apiFetch<{ low: number; medium: number; high: number; average: string | number }>(`/api/v1/analytics/ai-confidence?${qs({ days })}`)
}
