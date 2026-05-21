import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, FolderOpen, Gauge, Users } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { KpiStrip } from '../ui/KpiCard'
import { AssignmentsChart } from '../charts/WorkCharts'
import { DeadlinesTrendChart, PriorityPieChart, StatusDonutChart, WorkloadBalanceChart } from '../charts/PerformanceCharts'
import { DashboardProjectProgressChart } from '../charts/DashboardCharts'
import {
  AnalyticsCard, AnalyticsErrorNotice, AnalyticsLoadingBlock, AnalyticsRiskQueue,
  EmptyAnalyticsState, numberValue as n, percent as pct,
} from '../analytics/AnalyticsPrimitives'

type AnalyticsSummary = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  overdue_tasks: number
  active_employees: number
  avg_completion_hours?: string | number
  avg_ai_confidence?: string | number
}

type TrendPoint = { day: string; created?: number; completed?: number; overdue?: number }
type StatusPoint = { status: string; count: number }
type PriorityPoint = { priority: string; count: number }

type ProjectSummary = {
  project_id: string
  project_name: string
  total_tasks: number
  completed_tasks: number
  open_tasks: number
  overdue_tasks: number
  high_priority_tasks: number
  completion_rate: number | null
}

type WorkloadEmployee = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }

type SlaRisk = {
  summary: {
    open_tasks: number
    overdue_tasks: number
    due_soon_72h: number
    critical_priority_open: number
    stalled_pending: number
    review_backlog: number
  }
  tasks: Array<{
    task_id: string
    title: string
    status: string
    priority: string
    due_date?: string | null
    assigned_to_name?: string | null
    risk_score: number
    risk_reason: string
  }>
}

async function fetchSummary(days: number) {
  return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`)
}
async function fetchTrend(days: number) {
  const data = await apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?days=${days}`)
  return data.points || []
}
async function fetchStatus(days: number) {
  const data = await apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?days=${days}`)
  return data.statuses || []
}
async function fetchPriority(days: number) {
  const data = await apiFetch<{ priorities: PriorityPoint[] }>(`/api/v1/analytics/priority-breakdown?days=${days}`)
  return data.priorities || []
}
async function fetchProjects(days: number) {
  const data = await apiFetch<{ projects: ProjectSummary[] }>(`/api/v1/analytics/project-summary?days=${days}`)
  return data.projects || []
}
async function fetchWorkload(days: number) {
  const data = await apiFetch<{ employees: WorkloadEmployee[] }>(`/api/v1/analytics/workload?days=${days}`)
  return data.employees || []
}
async function fetchSlaRisk(days: number) {
  return apiFetch<SlaRisk>(`/api/v1/analytics/sla-risk?days=${days}`)
}

function statusMap(points: StatusPoint[] = []) {
  return Object.fromEntries(points.map((p) => [p.status, n(p.count)]))
}
function priorityMap(points: PriorityPoint[] = []) {
  return Object.fromEntries(points.map((p) => [String(p.priority || 'unspecified').toLowerCase(), n(p.count)]))
}

export function DashboardAnalyticsPanel({ days = 30 }: { days?: number }) {
  const summaryQ = useQuery(liveAnalyticsQueryOptions<AnalyticsSummary>({ queryKey: ['dashboard-live-summary', days], queryFn: () => fetchSummary(days) }))
  const trendQ = useQuery(liveAnalyticsQueryOptions<TrendPoint[]>({ queryKey: ['dashboard-live-trend', days], queryFn: () => fetchTrend(days) }))
  const statusQ = useQuery(liveAnalyticsQueryOptions<StatusPoint[]>({ queryKey: ['dashboard-live-status', days], queryFn: () => fetchStatus(days) }))
  const priorityQ = useQuery(liveAnalyticsQueryOptions<PriorityPoint[]>({ queryKey: ['dashboard-live-priority', days], queryFn: () => fetchPriority(days) }))
  const projectQ = useQuery(liveAnalyticsQueryOptions<ProjectSummary[]>({ queryKey: ['dashboard-live-projects', days], queryFn: () => fetchProjects(days) }))
  const workloadQ = useQuery(liveAnalyticsQueryOptions<WorkloadEmployee[]>({ queryKey: ['dashboard-live-workload', days], queryFn: () => fetchWorkload(days) }))
  const slaQ = useQuery(liveAnalyticsQueryOptions<SlaRisk>({ queryKey: ['dashboard-live-sla', days], queryFn: () => fetchSlaRisk(days) }))

  const summary = summaryQ.data
  const projects = projectQ.data || []
  const workload = workloadQ.data || []
  const total = n(summary?.total_tasks)
  const completed = n(summary?.completed_tasks)
  const overdue = n(summary?.overdue_tasks)
  const pending = n(summary?.pending_tasks)
  const completionRate = pct(completed, total)
  const activePeople = workload.filter((row) => n(row.total_tasks) > 0 || n(row.open_tasks) > 0).length
  const openTasks = n(slaQ.data?.summary?.open_tasks)
  const riskSignals = n(slaQ.data?.summary?.overdue_tasks) + n(slaQ.data?.summary?.due_soon_72h) + n(slaQ.data?.summary?.critical_priority_open) + n(slaQ.data?.summary?.stalled_pending) + n(slaQ.data?.summary?.review_backlog)
  const healthScore = useMemo(() => {
    if (!total) return 0
    return Math.max(0, Math.min(100, Math.round(completionRate * 0.55 + (100 - pct(overdue, total)) * 0.30 + (100 - Math.min(100, riskSignals * 8)) * 0.15)))
  }, [completionRate, overdue, riskSignals, total])

  const loading = summaryQ.isLoading || trendQ.isLoading || projectQ.isLoading || workloadQ.isLoading || slaQ.isLoading
  const hasError = summaryQ.isError || trendQ.isError || statusQ.isError || priorityQ.isError || projectQ.isError || workloadQ.isError || slaQ.isError

  const byStatus = statusMap(statusQ.data)
  const byPriority = priorityMap(priorityQ.data)
  const workloadBalance = useMemo(() => {
    const avg = workload.length ? workload.reduce((s, e) => s + n(e.open_tasks), 0) / workload.length : 0
    return {
      averageOpenTasks: avg,
      overloaded: workload.filter((e) => n(e.open_tasks) > Math.max(5, avg * 1.5)),
      underutilized: workload.filter((e) => n(e.open_tasks) <= Math.max(1, avg * 0.35)),
    }
  }, [workload])

  const projectRows = useMemo(
    () => projects
      .filter((p) => n(p.total_tasks) > 0)
      .map((p) => {
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
      }),
    [projects],
  )

  const assignmentRows = useMemo(
    () => workload
      .filter((e) => n(e.total_tasks) > 0)
      .map((e) => ({
        name: e.employee_name || 'Unassigned',
        active: n(e.open_tasks),
        overdue: 0,
        done: Math.max(0, n(e.total_tasks) - n(e.open_tasks)),
      })),
    [workload],
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {hasError && <AnalyticsErrorNotice message="Live dashboard analytics failed to load. The panel will retry automatically." />}
      <KpiStrip
        loading={loading}
        skeletonCount={6}
        items={[
          { label: 'Live Health', value: total ? `${healthScore}%` : '—', color: healthScore >= 75 ? '#22c55e' : healthScore >= 50 ? '#e2ab41' : '#ef4444', icon: <Gauge size={34} />, sub: 'backend analytics' },
          { label: 'Tasks in Scope', value: total, color: '#38bdf8', icon: <BarChart3 size={34} />, sub: `${days}d live data` },
          { label: 'Completed', value: completed, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${completionRate}% rate` },
          { label: 'Open Tasks', value: openTasks, color: '#8b5cf6', icon: <Clock3 size={34} />, sub: `${pending} pending` },
          { label: 'Projects', value: projects.length, color: '#e2ab41', icon: <FolderOpen size={34} />, sub: 'tracked live' },
          { label: 'Risk Signals', value: riskSignals, color: riskSignals ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: `${overdue} overdue` },
        ]}
      />

      <div className="analyticsHeroRow">
        <AnalyticsCard title="Live Activity Flow" subtitle={`Created · completed · overdue — last ${days} days`}>
          {trendQ.isLoading ? (
            <AnalyticsLoadingBlock height={230} />
          ) : !(trendQ.data || []).length ? (
            <EmptyAnalyticsState title="No activity trend" detail="No task movement in the selected period." />
          ) : (
            <DeadlinesTrendChart
              fillHeight
              loading={false}
              points={(trendQ.data || []).map((p) => ({
                day: String(p.day).slice(5, 10),
                due: n(p.created),
                completed: n(p.completed),
                overdue: n(p.overdue),
              }))}
            />
          )}
        </AnalyticsCard>
        <AnalyticsCard title="Status Distribution" subtitle="Live lifecycle mix">
          {statusQ.isLoading ? <AnalyticsLoadingBlock height={200} /> : <StatusDonutChart byStatus={byStatus} loading={false} />}
        </AnalyticsCard>
      </div>

      <div className="analyticsChartGrid">
        <AnalyticsCard title="Priority Pressure" subtitle="Radar view of urgency mix">
          {priorityQ.isLoading ? <AnalyticsLoadingBlock height={200} /> : <PriorityPieChart byPriority={byPriority} loading={false} />}
        </AnalyticsCard>
        <AnalyticsCard title="Workload Balance" subtitle="Overloaded vs underutilized">
          {workloadQ.isLoading ? <AnalyticsLoadingBlock height={200} /> : <WorkloadBalanceChart userCount={workload.length} workload={workloadBalance} loading={false} />}
        </AnalyticsCard>
        <AnalyticsCard title="SLA Risk Queue" subtitle="Highest-risk operational tasks">
          {slaQ.isLoading ? <AnalyticsLoadingBlock height={200} /> : <AnalyticsRiskQueue tasks={slaQ.data?.tasks} emptyTitle="No dashboard SLA risk queue" limit={5} />}
        </AnalyticsCard>
      </div>

      <div className="analyticsChartGrid">
        <AnalyticsCard title="Project Workload" subtitle="Completion split by project">
          {projectQ.isLoading ? (
            <AnalyticsLoadingBlock height={200} />
          ) : !projectRows.length ? (
            <EmptyAnalyticsState title="No project workload" detail="No projects with tasks in this period." />
          ) : (
            <DashboardProjectProgressChart projects={projectRows} />
          )}
        </AnalyticsCard>
        <AnalyticsCard title="Team Load" subtitle="Stacked assignment volume">
          {workloadQ.isLoading ? (
            <AnalyticsLoadingBlock height={230} />
          ) : !assignmentRows.length ? (
            <EmptyAnalyticsState title="No team load" detail="No assignees with tasks in this period." />
          ) : (
            <AssignmentsChart rows={assignmentRows} loading={false} />
          )}
        </AnalyticsCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="miniCard"><Activity size={16} color="#38bdf8" /><strong>{trendQ.data?.length || 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>trend days loaded</span></div>
        <div className="miniCard"><Users size={16} color="#8b5cf6" /><strong>{activePeople}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>people in workload</span></div>
        <div className="miniCard"><AlertTriangle size={16} color="#ef4444" /><strong>{slaQ.data?.summary?.due_soon_72h ?? 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>tasks due within 72h</span></div>
      </div>
    </div>
  )
}
