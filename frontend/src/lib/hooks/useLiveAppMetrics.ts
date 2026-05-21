import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api'
import { liveAnalyticsQueryOptions } from '../analyticsQueryOptions'
import { useRealtimeInvalidation } from '../socket'

export type DashStats = {
  tasks?: {
    total?: number
    pending?: number
    in_progress?: number
    submitted?: number
    completed?: number
    overdue?: number
    cancelled?: number
    completion_rate?: number
    due_today?: number
    due_week?: number
  }
  trend?: Array<{ day: string; label?: string; completed?: number; overdue?: number; created?: number }>
  projects?: Array<{
    id: string
    name: string
    color?: string | null
    total: number
    completed: number
    overdue: number
    in_progress: number
    pending: number
    progress: number
  }>
  leaderboard?: Array<{
    id: string
    name: string
    total: number
    completed: number
    overdue: number
    completion_rate: number
  }>
  priority?: Record<string, number>
  velocity?: Array<{ week: string; created?: number; completed?: number }>
}

export type AnalyticsSummary = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  overdue_tasks: number
  active_employees: number
  avg_completion_hours?: string | number
}

export type TrendPoint = { day: string; created?: number; completed?: number; overdue?: number }
export type StatusPoint = { status: string; count: number }
export type PriorityPoint = { priority: string; count: number }

export function n(v: unknown) {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

export function pct(num: number, den: number) {
  return den ? Math.round((num / den) * 100) : 0
}

export function statusMap(points: StatusPoint[] = []) {
  return Object.fromEntries(points.map((p) => [p.status, n(p.count)]))
}

export function priorityMap(points: PriorityPoint[] = []) {
  return Object.fromEntries(points.map((p) => [String(p.priority || 'unspecified').toLowerCase(), n(p.count)]))
}

export function useLiveAppMetrics(days = 30, opts?: { enableDash?: boolean }) {
  const enableDash = opts?.enableDash !== false

  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })

  const dashQ = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<DashStats>('/api/v1/stats/dashboard'),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: enableDash,
  })

  const summaryQ = useQuery(
    liveAnalyticsQueryOptions<AnalyticsSummary>({
      queryKey: ['analytics-summary', days],
      queryFn: () => apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`),
    }),
  )

  const trendQ = useQuery(
    liveAnalyticsQueryOptions<{ points: TrendPoint[] }>({
      queryKey: ['analytics-trend', days],
      queryFn: () => apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?days=${days}`),
    }),
  )

  const statusQ = useQuery(
    liveAnalyticsQueryOptions<{ statuses: StatusPoint[] }>({
      queryKey: ['analytics-status', days],
      queryFn: () => apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?days=${days}`),
    }),
  )

  const priorityQ = useQuery(
    liveAnalyticsQueryOptions<{ priorities: PriorityPoint[] }>({
      queryKey: ['analytics-priority', days],
      queryFn: () => apiFetch<{ priorities: PriorityPoint[] }>(`/api/v1/analytics/priority-breakdown?days=${days}`),
    }),
  )

  const trend = trendQ.data?.points || dashQ.data?.trend || []
  const byStatus = useMemo(() => {
    const fromApi = statusMap(statusQ.data?.statuses)
    if (Object.keys(fromApi).length) return fromApi
    const t = dashQ.data?.tasks
    if (!t) return {}
    return {
      pending: n(t.pending),
      in_progress: n(t.in_progress),
      submitted: n(t.submitted),
      completed: n(t.completed),
      overdue: n(t.overdue),
      cancelled: n(t.cancelled),
    }
  }, [statusQ.data, dashQ.data])

  const byPriority = useMemo(() => {
    const fromApi = priorityMap(priorityQ.data?.priorities)
    if (Object.keys(fromApi).length) return fromApi
    return dashQ.data?.priority || {}
  }, [priorityQ.data, dashQ.data])

  const summary = summaryQ.data
  const tasks = dashQ.data?.tasks
  const total = n(summary?.total_tasks) || n(tasks?.total)
  const completed = n(summary?.completed_tasks) || n(tasks?.completed)
  const overdue = n(summary?.overdue_tasks) || n(tasks?.overdue)
  const pending = n(summary?.pending_tasks) || n(tasks?.pending)
  const completionRate = n(tasks?.completion_rate) || pct(completed, total)

  const trendSeries = useMemo(
    () =>
      trend.slice(-14).map((p) => ({
        day: String(p.day).slice(5, 10) || String(p.day),
        label: String(p.day).slice(5, 10),
        created: n(p.created),
        completed: n(p.completed),
        overdue: n(p.overdue),
      })),
    [trend],
  )

  const velocity = useMemo(() => {
    const raw = dashQ.data?.velocity?.slice(-8) || []
    return raw.map((v) => ({
      week: String(v.week || '').slice(0, 10),
      created: n(v.created),
      completed: n(v.completed),
    }))
  }, [dashQ.data])

  const dayOfWeek = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const buckets = labels.map((label) => ({ label, completed: 0, created: 0 }))
    for (const p of trend) {
      const d = new Date(p.day)
      if (Number.isNaN(d.getTime())) continue
      const idx = d.getDay()
      buckets[idx].completed += n(p.completed)
      buckets[idx].created += n(p.created)
    }
    return buckets.map((b) => ({
      ...b,
      rate: b.created ? Math.round((b.completed / b.created) * 100) : b.completed > 0 ? 100 : 0,
    }))
  }, [trend])

  const loading =
    summaryQ.isLoading ||
    trendQ.isLoading ||
    statusQ.isLoading ||
    (enableDash && dashQ.isLoading)

  return {
    days,
    loading,
    dashQ,
    summaryQ,
    trendQ,
    statusQ,
    priorityQ,
    dash: dashQ.data,
    tasks,
    total,
    completed,
    overdue,
    pending,
    completionRate,
    byStatus,
    byPriority,
    trendSeries,
    velocity,
    dayOfWeek,
    projects: dashQ.data?.projects || [],
    leaderboard: dashQ.data?.leaderboard || [],
  }
}
