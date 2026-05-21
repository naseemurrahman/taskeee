import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { useLiveAppMetrics, pct, n } from '../../lib/hooks/useLiveAppMetrics'
import { KpiStrip } from '../ui/KpiCard'
import { ChartCard } from '../charts/ChartCard'
import { AssignmentsChart } from '../charts/WorkCharts'
import {
  DeadlinesTrendChart, PriorityPieChart, StatusBarChart, StatusDonutChart,
  WorkloadBalanceChart, AssigneeScoreChart,
} from '../charts/PerformanceCharts'
import {
  DashboardHeroPanel, DashboardProjectProgressChart, DashboardVelocityChart,
  DashboardTeamPerformanceChart,
} from '../charts/DashboardCharts'
import {
  KpiSummarySection, KpiMetricGrid, GaugeKpiCard, WeeklyDayBars, MultiRingProgress,
  StackedActivityChart, DualTrendAreaChart, HorizontalCategoryChart, EfficiencyBarChart,
  WeekdayProductivityDonut, QuickInsightsPanel, buildLiveInsights, trendPct, trendDir,
} from '../charts/AdvancedVisuals'
import { AnalyticsErrorNotice, AnalyticsRiskQueue } from '../analytics/AnalyticsPrimitives'
import { Gauge, BarChart3, CheckCircle2, Clock3, FolderOpen, AlertTriangle } from 'lucide-react'

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
  const data = await apiFetch<{ employees: Array<{ employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }> }>(`/api/v1/analytics/workload?days=${days}`)
  return data.employees || []
}

export function EnhancedDashboardPanel({ days = 30 }: { days?: number }) {
  const m = useLiveAppMetrics(days)
  const slaQ = useQuery(liveAnalyticsQueryOptions<SlaRisk>({ queryKey: ['dashboard-live-sla', days], queryFn: () => fetchSlaRisk(days) }))
  const projectQ = useQuery(liveAnalyticsQueryOptions({ queryKey: ['dashboard-live-projects', days], queryFn: () => fetchProjects(days) }))
  const workloadQ = useQuery(liveAnalyticsQueryOptions({ queryKey: ['dashboard-live-workload', days], queryFn: () => fetchWorkload(days) }))

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
    const fromDash = m.projects || []
    if (fromDash.length) return fromDash
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

  const assignmentRows = useMemo(() => {
    if (m.leaderboard.length) {
      return m.leaderboard.slice(0, 8).map((u) => ({
        name: u.name,
        active: Math.max(0, u.total - u.completed - (u.overdue || 0)),
        overdue: u.overdue || 0,
        done: u.completed,
      }))
    }
    return workload.slice(0, 8).map((e) => ({
      name: e.employee_name || 'Unassigned',
      active: n(e.open_tasks),
      overdue: 0,
      done: Math.max(0, n(e.total_tasks) - n(e.open_tasks)),
    }))
  }, [m.leaderboard, workload])

  const performanceRows = useMemo(
    () => workload.map((e) => {
      const assigned = n(e.total_tasks)
      const done = Math.max(0, assigned - n(e.open_tasks))
      const score = assigned ? Math.round((done / assigned) * 100) : 0
      return { name: e.employee_name || 'Unassigned', active: n(e.open_tasks), completed: done, performanceScore: score }
    }),
    [workload],
  )

  const trendSpark = useMemo(() => m.trendSeries.map((p) => p.completed), [m.trendSeries])
  const createdSpark = useMemo(() => m.trendSeries.map((p) => p.created), [m.trendSeries])

  const recentDone = m.trendSeries.slice(-2).reduce((s, p) => s + p.completed, 0)
  const prevDone = m.trendSeries.slice(-4, -2).reduce((s, p) => s + p.completed, 0)
  const completionTrend = trendPct(recentDone, prevDone)

  const weeklyBars = useMemo(() => {
    const last7 = m.trendSeries.slice(-7)
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    return last7.map((p, i) => ({
      label: p.label?.slice(0, 1).toUpperCase() || labels[i % 7],
      value: p.completed,
    }))
  }, [m.trendSeries])

  const stackedMonths = useMemo(() => {
    return m.trendSeries.slice(-8).map((p) => ({
      label: p.label,
      completed: p.completed,
      open: Math.max(0, p.created - p.completed),
    }))
  }, [m.trendSeries])

  const efficiencyWeeks = useMemo(() => {
    return m.velocity.map((v) => ({
      label: v.week.slice(0, 6),
      efficiency: v.created ? Math.min(120, Math.round((v.completed / v.created) * 100)) : v.completed ? 100 : 0,
    }))
  }, [m.velocity])

  const categoryRows = useMemo(
    () => projectRows.slice(0, 6).map((p, i) => ({
      name: p.name,
      value: p.total,
      color: ['#6366f1', '#38bdf8', '#14b8a6', '#8b5cf6', '#f97316', '#22c55e'][i % 6],
    })),
    [projectRows],
  )

  const statusRings = useMemo(() => {
    const order = [
      { key: 'completed', label: 'Done', color: '#22c55e' },
      { key: 'in_progress', label: 'Active', color: '#8b5cf6' },
      { key: 'submitted', label: 'Review', color: '#38bdf8' },
      { key: 'overdue', label: 'Overdue', color: '#ef4444' },
    ]
    const total = Math.max(1, Object.values(m.byStatus).reduce((s, v) => s + n(v), 0))
    return order
      .map((o) => ({ ...o, value: n(m.byStatus[o.key]), pct: pct(n(m.byStatus[o.key]), total) }))
      .filter((r) => r.value > 0)
  }, [m.byStatus])

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
    [m],
  )

  const hasError = m.summaryQ.isError || m.trendQ.isError || m.dashQ.isError

  return (
    <div className="dashChartsSection">
      {hasError && <AnalyticsErrorNotice message="Some live metrics failed to load — charts will retry automatically." />}

      <KpiStrip
        loading={m.loading}
        skeletonCount={6}
        items={[
          { label: 'Health Score', value: m.total ? `${healthScore}%` : '—', color: healthScore >= 75 ? '#22c55e' : healthScore >= 50 ? '#e2ab41' : '#ef4444', icon: <Gauge size={34} />, sub: 'live composite' },
          { label: 'Tasks', value: m.total, color: '#38bdf8', icon: <BarChart3 size={34} />, sub: `${days}d scope` },
          { label: 'Completed', value: m.completed, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${m.completionRate}% rate` },
          { label: 'Open', value: n(slaQ.data?.summary?.open_tasks) || m.pending, color: '#8b5cf6', icon: <Clock3 size={34} />, sub: `${m.pending} pending` },
          { label: 'Projects', value: projectRows.length, color: '#e2ab41', icon: <FolderOpen size={34} />, sub: 'tracked' },
          { label: 'Risk', value: riskSignals, color: riskSignals ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: `${m.overdue} overdue` },
        ]}
      />

      <div className="dashChartsHero">
        <DashboardHeroPanel
          loading={m.loading}
          trend={m.trendSeries}
          tasks={m.tasks}
          priority={m.byPriority}
        />
      </div>

      <KpiSummarySection live>
        <div className="kpiSummaryGaugeRow">
          <GaugeKpiCard
            title="Completion health"
            valueLabel={`${m.completionRate}%`}
            pct={m.completionRate}
            minLabel="0%"
            maxLabel="100%"
            trendPct={completionTrend}
            sparkline={trendSpark}
            color="#22c55e"
            loading={m.loading}
          />
          <GaugeKpiCard
            title="Throughput (7d)"
            valueLabel={`${recentDone}`}
            pct={m.total ? Math.min(100, Math.round((recentDone / Math.max(m.total, 1)) * 100)) : 0}
            minLabel="tasks"
            maxLabel="done"
            trendPct={trendPct(
              m.trendSeries.slice(-7).reduce((s, p) => s + p.created, 0),
              m.trendSeries.slice(-14, -7).reduce((s, p) => s + p.created, 0),
            )}
            sparkline={createdSpark}
            color="#f59e0b"
            loading={m.loading}
          />
        </div>
      </KpiSummarySection>

      <KpiMetricGrid
        loading={m.loading}
        items={[
          { title: 'Tasks completed', value: m.completed, sub: 'in current scope', trend: completionTrend, trendDir: trendDir(recentDone, prevDone) },
          { title: 'In progress', value: n(m.byStatus.in_progress), sub: 'active work now', trend: pct(n(m.byStatus.in_progress), m.total), trendDir: 'neutral' },
          { title: 'Overdue', value: m.overdue, sub: 'needs action', trend: pct(m.overdue, m.total), trendDir: m.overdue > 0 ? 'down' : 'up' },
          { title: 'Due this week', value: n(m.tasks?.due_week), sub: 'from live dashboard', trend: n(m.tasks?.due_today), trendDir: 'neutral' },
        ]}
      />

      <div className="dashChartsRow2">
        <ChartCard title="Weekly progress" subtitle="Completions per day (live trend)" loading={m.loading}>
          <WeeklyDayBars
            days={weeklyBars}
            highlightIndex={weeklyBars.length ? weeklyBars.reduce((best, d, i, arr) => (d.value > arr[best].value ? i : best), 0) : undefined}
            loading={m.loading}
          />
        </ChartCard>
        <ChartCard title="Status rings" subtitle="Share of work by lifecycle state" loading={m.loading}>
          <MultiRingProgress
            rings={statusRings}
            centerValue={`${m.completionRate}%`}
            centerSub="completion"
            loading={m.loading}
          />
        </ChartCard>
      </div>

      <div className="analyticsHeroRow">
        <ChartCard title="Monthly progress" subtitle="Created vs completed (live)" loading={m.trendQ.isLoading} fillHeight>
          <DualTrendAreaChart points={m.trendSeries} loading={m.trendQ.isLoading} />
        </ChartCard>
        <ChartCard title="Status distribution" subtitle="Donut from live API" loading={m.statusQ.isLoading}>
          <StatusDonutChart byStatus={m.byStatus} loading={m.statusQ.isLoading} />
        </ChartCard>
      </div>

      <ChartCard title="Team activity" subtitle="Completed vs still open per period" loading={m.trendQ.isLoading}>
        <StackedActivityChart points={stackedMonths} loading={m.trendQ.isLoading} />
      </ChartCard>

      <div className="analyticsChartGrid">
        <ChartCard title="Tasks by status" subtitle="Volume + cumulative share %" loading={m.statusQ.isLoading}>
          <StatusBarChart byStatus={m.byStatus} loading={m.statusQ.isLoading} />
        </ChartCard>
        <ChartCard title="Priority pressure" subtitle="Live priority mix" loading={m.priorityQ.isLoading}>
          <PriorityPieChart byPriority={m.byPriority} loading={m.priorityQ.isLoading} />
        </ChartCard>
        <ChartCard title="Workload balance" subtitle="Overloaded vs underutilized" loading={workloadQ.isLoading}>
          <WorkloadBalanceChart userCount={workload.length} workload={workloadBalance} loading={workloadQ.isLoading} />
        </ChartCard>
      </div>

      <div className="analyticsChartGrid advChartsTriple">
        <ChartCard title="Weekly throughput" subtitle="Completion % per week" loading={m.loading}>
          <EfficiencyBarChart points={efficiencyWeeks} loading={m.loading} />
        </ChartCard>
        <ChartCard title="Tasks by project" subtitle="Live project-summary API" loading={projectQ.isLoading}>
          <HorizontalCategoryChart rows={categoryRows} loading={projectQ.isLoading} />
        </ChartCard>
        <ChartCard title="Productivity by weekday" subtitle="Completion rate per day-of-week" loading={m.trendQ.isLoading}>
          <WeekdayProductivityDonut days={m.dayOfWeek} loading={m.trendQ.isLoading} />
        </ChartCard>
      </div>

      <div className="analyticsChartGrid">
        <ChartCard title="Quick insights" subtitle="Rule-based signals from live metrics" loading={m.loading}>
          <QuickInsightsPanel insights={insights} loading={m.loading} />
        </ChartCard>
        <ChartCard title="Activity flow" subtitle={`${days}-day created / completed / overdue`} loading={m.trendQ.isLoading} fillHeight>
          <DeadlinesTrendChart
            fillHeight
            loading={m.trendQ.isLoading}
            points={m.trendSeries.map((p) => ({ day: p.label, due: p.created, completed: p.completed, overdue: p.overdue }))}
          />
        </ChartCard>
      </div>

      <div className="analyticsChartGrid">
        <ChartCard title="Project progress" subtitle="Live completion split" loading={projectQ.isLoading}>
          <DashboardProjectProgressChart projects={projectRows} />
        </ChartCard>
        <ChartCard title="Weekly velocity" subtitle="Created vs completed per week" loading={m.dashQ.isLoading}>
          <DashboardVelocityChart data={m.velocity.map((v) => ({ week: v.week, created: v.created, completed: v.completed }))} loading={m.dashQ.isLoading} />
        </ChartCard>
      </div>

      <div className="analyticsChartGrid">
        <ChartCard title="Team performance" subtitle="Score curve from workload API" loading={workloadQ.isLoading} fillHeight>
          <AssigneeScoreChart fillHeight rows={performanceRows} loading={workloadQ.isLoading} />
        </ChartCard>
        <ChartCard title="Team load" subtitle="Stacked assignments" loading={workloadQ.isLoading} fillHeight>
          <AssignmentsChart rows={assignmentRows} loading={workloadQ.isLoading} />
        </ChartCard>
        <ChartCard title="SLA risk queue" subtitle="Highest-risk live tasks" loading={slaQ.isLoading}>
          <AnalyticsRiskQueue tasks={slaQ.data?.tasks} limit={5} />
        </ChartCard>
      </div>

      <ChartCard title="Leaderboard" subtitle="Completion rate by assignee" loading={m.dashQ.isLoading}>
        <DashboardTeamPerformanceChart rows={m.leaderboard} />
      </ChartCard>
    </div>
  )
}
