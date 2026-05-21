import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { useLiveAppMetrics, pct, n, type LiveMetrics } from '../../lib/hooks/useLiveAppMetrics'
import { KpiStrip } from '../ui/KpiCard'
import { ChartCard } from '../charts/ChartCard'
import {
  DeadlinesTrendChart, PriorityPieChart, StatusDonutChart, WorkloadBalanceChart,
} from '../charts/PerformanceCharts'
import {
  DashboardHeroPanel, DashboardProjectProgressChart, DashboardPriorityBars,
  DashboardTeamPerformanceChart, type ActivityPoint,
} from '../charts/DashboardCharts'
import {
  KpiMetricGrid, DualTrendAreaChart, QuickInsightsPanel, buildLiveInsights, trendPct, trendDir,
} from '../charts/AdvancedVisuals'
import { AnalyticsErrorNotice, AnalyticsRiskQueue } from '../analytics/AnalyticsPrimitives'
import { Gauge, BarChart3, CheckCircle2, AlertTriangle } from 'lucide-react'

type SlaRisk = {
  summary: Record<string, number>
  tasks: Array<{ task_id?: string; title?: string; risk_score?: number; risk_reason?: string }>
}

async function fetchSlaRisk(days: number) {
  return apiFetch<SlaRisk>(`/api/v1/analytics/sla-risk?days=${days}`)
}

async function fetchProjects(days: number) {
  const data = await apiFetch<{ projects: Array<{
    project_id: string; project_name: string; total_tasks: number
    completed_tasks: number; open_tasks: number; overdue_tasks: number
    completion_rate: number | null
  }> }>(`/api/v1/analytics/project-summary?days=${days}`)
  return data.projects || []
}

async function fetchWorkload(days: number) {
  const data = await apiFetch<{ employees: Array<{ employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }> }>(
    `/api/v1/analytics/workload?days=${days}`,
  )
  return data.employees || []
}

export function EnhancedDashboardPanel(props: { days?: number; metrics?: LiveMetrics }) {
  const days = props.days ?? 30
  const internal = useLiveAppMetrics(days, { skipRealtime: Boolean(props.metrics) })
  const m = props.metrics ?? internal

  const slaQ = useQuery(liveAnalyticsQueryOptions<SlaRisk>({
    queryKey: ['dashboard-live-sla', days],
    queryFn: () => fetchSlaRisk(days),
  }))
  const projectQ = useQuery(liveAnalyticsQueryOptions({
    queryKey: ['dashboard-live-projects', days],
    queryFn: () => fetchProjects(days),
    enabled: !(m.projects?.length),
  }))
  const workloadQ = useQuery(liveAnalyticsQueryOptions({
    queryKey: ['dashboard-live-workload', days],
    queryFn: () => fetchWorkload(days),
  }))

  const workload = workloadQ.data || []
  const riskSignals =
    n(slaQ.data?.summary?.overdue_tasks) +
    n(slaQ.data?.summary?.due_soon_72h) +
    n(slaQ.data?.summary?.critical_priority_open) +
    n(slaQ.data?.summary?.stalled_pending) +
    n(slaQ.data?.summary?.review_backlog)

  const healthScore = useMemo(() => {
    if (!m.total) return 0
    return Math.max(0, Math.min(100, Math.round(
      m.completionRate * 0.55 +
      (100 - pct(m.overdue, m.total)) * 0.30 +
      (100 - Math.min(100, riskSignals * 8)) * 0.15,
    )))
  }, [m.completionRate, m.overdue, m.total, riskSignals])

  const workloadBalance = useMemo(() => {
    const avg = workload.length ? workload.reduce((s, e) => s + n(e.open_tasks), 0) / workload.length : 0
    return {
      averageOpenTasks: avg,
      overloaded: workload.filter((e) => n(e.open_tasks) > Math.max(5, avg * 1.5)),
      underutilized: workload.filter((e) => n(e.open_tasks) <= Math.max(1, avg * 0.35)),
    }
  }, [workload])

  const projectRows = useMemo(() => {
    if (m.projects.length) return m.projects
    return (projectQ.data || []).map((p) => {
      const total = n(p.total_tasks)
      const completed = n(p.completed_tasks)
      const open = n(p.open_tasks)
      const overdue = n(p.overdue_tasks)
      return {
        id: p.project_id,
        name: p.project_name,
        total,
        completed,
        overdue,
        in_progress: open,
        pending: Math.max(0, total - completed - open - overdue),
        progress: p.completion_rate != null ? Math.round(p.completion_rate) : pct(completed, total),
      }
    })
  }, [m.projects, projectQ.data])

  const teamRows = useMemo(
    () => (m.leaderboard || []).map((u, i) => ({
      id: String((u as { id?: string; employee_id?: string }).id ?? (u as { employee_id?: string }).employee_id ?? `lb-${i}`),
      name: u.name || 'Unassigned',
      total: n(u.total),
      completed: n(u.completed),
      completion_rate: n(u.completion_rate),
    })),
    [m.leaderboard],
  )

  const heroTrend: ActivityPoint[] = useMemo(
    () => m.trendSeries.map((p) => ({
      day: String(p.day ?? p.label ?? ''),
      label: String(p.label ?? p.day ?? ''),
      created: n(p.created),
      completed: n(p.completed),
      overdue: n(p.overdue),
    })),
    [m.trendSeries],
  )

  const recentDone = m.trendSeries.slice(-2).reduce((s, p) => s + p.completed, 0)
  const prevDone = m.trendSeries.slice(-4, -2).reduce((s, p) => s + p.completed, 0)

  const insights = useMemo(
    () => buildLiveInsights({
      total: m.total,
      completed: m.completed,
      overdue: m.overdue,
      completionRate: m.completionRate,
      trendSeries: m.trendSeries,
      byStatus: m.byStatus,
      dayOfWeek: m.dayOfWeek,
    }),
    [m.total, m.completed, m.overdue, m.completionRate, m.trendSeries, m.byStatus, m.dayOfWeek],
  )

  const hasError = m.summaryQ.isError || m.trendQ.isError || m.dashQ.isError
  const chartsLoading = m.loading || workloadQ.isLoading

  return (
    <div className="dashChartsSection dashChartsV3">
      {hasError && (
        <AnalyticsErrorNotice message="Some live metrics failed to load — charts will retry automatically." />
      )}

      <KpiStrip
        loading={m.loading}
        skeletonCount={4}
        items={[
          { label: 'Health', value: m.total ? `${healthScore}%` : '—', color: healthScore >= 75 ? '#22c55e' : healthScore >= 50 ? '#e2ab41' : '#ef4444', icon: <Gauge size={34} />, sub: 'live score' },
          { label: 'Tasks', value: m.total, color: '#6366f1', icon: <BarChart3 size={34} />, sub: `${days}d window` },
          { label: 'Completed', value: m.completed, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${m.completionRate}%` },
          { label: 'Overdue', value: m.overdue, color: m.overdue ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: `${riskSignals} risk signals` },
        ]}
      />

      <div className="dashChartsHero">
        <DashboardHeroPanel
          loading={m.loading}
          trend={heroTrend}
          tasks={m.tasks}
          priority={m.byPriority}
        />
      </div>

      <KpiMetricGrid
        loading={m.loading}
        items={[
          { title: 'Completion rate', value: `${m.completionRate}%`, sub: 'of scoped tasks', trend: trendPct(recentDone, prevDone), trendDir: trendDir(recentDone, prevDone) },
          { title: 'Open work', value: n(slaQ.data?.summary?.open_tasks) || m.pending, sub: 'needs attention', trend: pct(m.pending, m.total), trendDir: 'neutral' },
          { title: 'Projects', value: projectRows.length, sub: 'with activity', trend: 0, trendDir: 'neutral' },
          { title: 'Due this week', value: n(m.tasks?.due_week), sub: `${n(m.tasks?.due_today)} due today`, trend: 0, trendDir: 'neutral' },
        ]}
      />

      <div className="dashChartsPriority">
        <ChartCard title="Task flow" subtitle="Created, completed, and overdue over time" loading={m.trendQ.isLoading} fillHeight>
          <DualTrendAreaChart points={m.trendSeries} loading={m.trendQ.isLoading} />
        </ChartCard>
        <ChartCard title="Status mix" subtitle="Live distribution" loading={m.statusQ.isLoading}>
          <StatusDonutChart byStatus={m.byStatus} loading={m.statusQ.isLoading} />
        </ChartCard>
      </div>

      <div className="analyticsChartGrid">
        <ChartCard title="Activity timeline" subtitle={`Last ${days} days`} loading={m.trendQ.isLoading} fillHeight>
          <DeadlinesTrendChart
            fillHeight
            loading={m.trendQ.isLoading}
            points={m.trendSeries.map((p) => ({
              day: String(p.label ?? p.day ?? ''),
              due: n(p.created),
              completed: n(p.completed),
              overdue: n(p.overdue),
            }))}
          />
        </ChartCard>
        <ChartCard title="Priority load" subtitle="Urgency breakdown" loading={m.priorityQ.isLoading}>
          <PriorityPieChart byPriority={m.byPriority} loading={m.priorityQ.isLoading} />
        </ChartCard>
        <ChartCard title="Workload" subtitle="Team capacity signals" loading={workloadQ.isLoading}>
          <WorkloadBalanceChart userCount={workload.length} workload={workloadBalance} loading={workloadQ.isLoading} />
        </ChartCard>
      </div>

      <div className="dashChartsRow2">
        <ChartCard title="Projects" subtitle="Completion by project" loading={chartsLoading}>
          <DashboardProjectProgressChart projects={projectRows} />
        </ChartCard>
        <ChartCard title="Priority queue" subtitle="Open tasks by urgency" loading={m.loading}>
          <DashboardPriorityBars priority={m.byPriority} />
        </ChartCard>
      </div>

      <div className="dashChartsRow2">
        <ChartCard title="Insights" subtitle="Generated from live metrics" loading={m.loading}>
          <QuickInsightsPanel insights={insights} loading={m.loading} />
        </ChartCard>
        <ChartCard title="SLA risk" subtitle="Tasks needing action" loading={slaQ.isLoading}>
          <AnalyticsRiskQueue tasks={slaQ.data?.tasks} limit={6} />
        </ChartCard>
      </div>

      <ChartCard title="Team leaderboard" subtitle="Completion rate by assignee" loading={m.dashQ.isLoading}>
        <DashboardTeamPerformanceChart rows={teamRows} />
      </ChartCard>
    </div>
  )
}
