import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, FolderOpen, Gauge, Users } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { KpiStrip } from '../ui/KpiCard'
import { AnalyticsCard, AnalyticsErrorNotice, AnalyticsLoadingBlock, AnalyticsRiskQueue, AnalyticsTrendLineChart, EmptyAnalyticsState, numberValue as n, percent as pct } from '../analytics/AnalyticsPrimitives'

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

function StatusPriorityMatrix({ statuses, priorities }: { statuses: StatusPoint[]; priorities: PriorityPoint[] }) {
  const statusRows = statuses.map((s) => ({ label: String(s.status || 'unknown').replace(/_/g, ' '), value: n(s.count), color: statusColor(String(s.status || '')) })).filter((row) => row.value > 0)
  const priorityRows = priorities.map((p) => ({ label: String(p.priority || 'unspecified'), value: n(p.count), color: priorityColor(String(p.priority || '')) })).filter((row) => row.value > 0)
  const rows = [...statusRows.slice(0, 5), ...priorityRows.slice(0, 5)]
  const max = Math.max(1, ...rows.map((row) => row.value))
  if (!rows.length) return <EmptyAnalyticsState title="No status or priority data" />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row, idx) => (
        <div key={`${row.label}-${idx}`} style={{ display: 'grid', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <strong style={{ fontSize: 12, textTransform: 'capitalize' }}>{row.label}</strong>
            <span style={{ color: row.color, fontSize: 12, fontWeight: 950 }}>{row.value}</span>
          </div>
          <div style={{ height: 9, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
            <i style={{ display: 'block', width: `${Math.max(4, row.value / max * 100)}%`, height: '100%', background: row.color, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function statusColor(value: string) {
  const key = value.toLowerCase()
  if (key.includes('completed') || key.includes('approved')) return '#22c55e'
  if (key.includes('overdue') || key.includes('rejected')) return '#ef4444'
  if (key.includes('submitted') || key.includes('review')) return '#38bdf8'
  if (key.includes('progress')) return '#8b5cf6'
  return '#e2ab41'
}
function priorityColor(value: string) {
  const key = value.toLowerCase()
  if (key === 'urgent' || key === 'critical') return '#ef4444'
  if (key === 'high') return '#f97316'
  if (key === 'medium') return '#8b5cf6'
  if (key === 'low') return '#38bdf8'
  return '#94a3b8'
}

function ProjectWorkload({ projects }: { projects: ProjectSummary[] }) {
  const rows = projects
    .filter((p) => n(p.total_tasks) > 0 || n(p.open_tasks) > 0)
    .sort((a, b) => n(b.overdue_tasks) - n(a.overdue_tasks) || n(b.open_tasks) - n(a.open_tasks))
    .slice(0, 8)
  if (!rows.length) return <EmptyAnalyticsState title="No project workload data" />
  const max = Math.max(1, ...rows.map((row) => n(row.total_tasks)))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => {
        const total = Math.max(1, n(row.total_tasks))
        const completed = n(row.completed_tasks)
        const open = n(row.open_tasks)
        const overdue = n(row.overdue_tasks)
        return (
          <div key={row.project_id || row.project_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.project_name}</strong>
              <span style={{ color: overdue > 0 ? '#ef4444' : '#22c55e', fontSize: 12, fontWeight: 950 }}>{pct(completed, total)}%</span>
            </div>
            <div style={{ width: `${Math.max(18, total / max * 100)}%`, maxWidth: '100%', display: 'flex', height: 10, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <i style={{ width: `${pct(completed, total)}%`, background: '#22c55e' }} />
              <i style={{ width: `${pct(open, total)}%`, background: '#8b5cf6' }} />
              <i style={{ width: `${pct(overdue, total)}%`, background: '#ef4444' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TeamLoad({ workload }: { workload: WorkloadEmployee[] }) {
  const rows = workload.filter((row) => n(row.total_tasks) > 0 || n(row.open_tasks) > 0).sort((a, b) => n(b.open_tasks) - n(a.open_tasks)).slice(0, 8)
  const maxOpen = Math.max(1, ...rows.map((row) => n(row.open_tasks)))
  if (!rows.length) return <EmptyAnalyticsState title="No team workload data" />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => {
        const open = n(row.open_tasks)
        const total = Math.max(1, n(row.total_tasks))
        const done = Math.max(0, total - open)
        const pressure = pct(open, maxOpen)
        const color = pressure > 75 ? '#ef4444' : pressure > 45 ? '#f97316' : '#22c55e'
        return (
          <div key={row.employee_id || row.employee_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee_name || 'Unassigned'}</strong>
              <span style={{ color, fontSize: 12, fontWeight: 950 }}>{open} open</span>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <i style={{ width: `${pct(done, total)}%`, background: '#22c55e' }} />
              <i style={{ width: `${pct(open, total)}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(min(100%,320px),.85fr)', gap: 16 }}>
        <AnalyticsCard title="Live Activity Flow" subtitle="Backend-generated created, completed, and overdue trend">
          {trendQ.isLoading ? <AnalyticsLoadingBlock height={210} /> : (
            <AnalyticsTrendLineChart
              points={trendQ.data || []}
              keys={['created', 'completed', 'overdue']}
              labels={{ created: 'Created', completed: 'Completed', overdue: 'Overdue' }}
              colors={{ created: '#e2ab41', completed: '#22c55e', overdue: '#ef4444' }}
              emptyTitle="No dashboard trend movement"
              emptyDetail="Created, completed, and overdue task movement will appear here."
              ariaLabel="Dashboard live trend"
            />
          )}
        </AnalyticsCard>
        <AnalyticsCard title="Status + Priority Mix" subtitle="Current operational distribution">
          {statusQ.isLoading || priorityQ.isLoading ? <AnalyticsLoadingBlock /> : <StatusPriorityMatrix statuses={statusQ.data || []} priorities={priorityQ.data || []} />}
        </AnalyticsCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        <AnalyticsCard title="Project Workload" subtitle="Backend project-summary completion/open/overdue split">
          {projectQ.isLoading ? <AnalyticsLoadingBlock /> : <ProjectWorkload projects={projects} />}
        </AnalyticsCard>
        <AnalyticsCard title="Team Load" subtitle="Backend workload API by employee">
          {workloadQ.isLoading ? <AnalyticsLoadingBlock /> : <TeamLoad workload={workload} />}
        </AnalyticsCard>
        <AnalyticsCard title="SLA Risk Queue" subtitle="Due-soon, overdue, stalled, critical, and review backlog">
          {slaQ.isLoading ? <AnalyticsLoadingBlock /> : <AnalyticsRiskQueue tasks={slaQ.data?.tasks} emptyTitle="No dashboard SLA risk queue" limit={5} />}
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
