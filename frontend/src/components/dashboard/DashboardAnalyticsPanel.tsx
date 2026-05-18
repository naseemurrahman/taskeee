import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, FolderOpen, Gauge, Users } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { KpiStrip } from '../ui/KpiCard'

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

function n(value: unknown) {
  return Number(value || 0)
}

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0
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

function Empty({ title, detail = 'No live dashboard analytics for the selected period.' }: { title: string; detail?: string }) {
  return (
    <div style={{ minHeight: 118, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 900 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 11 }}>{detail}</div>
      </div>
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0, overflow: 'hidden' }}>
      <div>
        <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 950 }}>{title}</div>
        {subtitle ? <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 750, marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

function Loading({ height = 165 }: { height?: number }) {
  return <div className="skeleton" style={{ height, borderRadius: 14 }} />
}

function ErrorNotice() {
  return <div className="alertV4 alertV4Error">Live dashboard analytics failed to load. The panel will retry automatically.</div>
}

function TrendMini({ points }: { points: TrendPoint[] }) {
  const rows = points.map((p) => ({ day: String(p.day || '').slice(5, 10), created: n(p.created), completed: n(p.completed), overdue: n(p.overdue) }))
  const total = rows.reduce((s, row) => s + row.created + row.completed + row.overdue, 0)
  if (!rows.length || total === 0) return <Empty title="No dashboard trend movement" detail="Created, completed, and overdue task movement will appear here." />

  const W = 720, H = 210, L = 34, R = 14, T = 14, B = 32
  const max = Math.max(1, ...rows.flatMap((row) => [row.created, row.completed, row.overdue]))
  const x = (i: number) => L + i * (W - L - R) / Math.max(1, rows.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const path = (key: 'created' | 'completed' | 'overdue') => rows.map((row, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(row[key])}`).join(' ')
  const tickEvery = Math.max(1, Math.ceil(rows.length / 6))

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="210" role="img" aria-label="Dashboard live trend">
        {[0, .25, .5, .75, 1].map((tick) => {
          const yy = T + tick * (H - T - B)
          return <line key={tick} x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(148,163,184,.16)" strokeDasharray="4 4" />
        })}
        <path d={path('created')} fill="none" stroke="#e2ab41" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('completed')} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('overdue')} fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
        {rows.map((row, i) => i % tickEvery === 0 || i === rows.length - 1 ? <text key={`${row.day}-${i}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--muted)">{row.day}</text> : null)}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', fontSize: 11, fontWeight: 800 }}>
        <span style={{ color: '#e2ab41' }}>● Created</span><span style={{ color: '#22c55e' }}>● Completed</span><span style={{ color: '#ef4444' }}>● Overdue</span>
      </div>
    </div>
  )
}

function StatusPriorityMatrix({ statuses, priorities }: { statuses: StatusPoint[]; priorities: PriorityPoint[] }) {
  const statusRows = statuses.map((s) => ({ label: String(s.status || 'unknown').replace(/_/g, ' '), value: n(s.count), color: statusColor(String(s.status || '')) })).filter((row) => row.value > 0)
  const priorityRows = priorities.map((p) => ({ label: String(p.priority || 'unspecified'), value: n(p.count), color: priorityColor(String(p.priority || '')) })).filter((row) => row.value > 0)
  const rows = [...statusRows.slice(0, 5), ...priorityRows.slice(0, 5)]
  const max = Math.max(1, ...rows.map((row) => row.value))
  if (!rows.length) return <Empty title="No status or priority data" />
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
  if (!rows.length) return <Empty title="No project workload data" />
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
  if (!rows.length) return <Empty title="No team workload data" />
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

function RiskQueue({ sla }: { sla?: SlaRisk }) {
  if (!sla?.tasks?.length) return <Empty title="No dashboard SLA risk queue" detail="No overdue, due-soon, stalled, critical, or review-backlog tasks." />
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {sla.tasks.slice(0, 5).map((task) => {
        const color = n(task.risk_score) >= 80 ? '#ef4444' : n(task.risk_score) >= 50 ? '#f97316' : '#e2ab41'
        return (
          <div key={task.task_id || task.title} className="miniCard" style={{ borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</strong>
              <span className="pill pillMuted" style={{ color }}>{task.risk_score}</span>
            </div>
            <div style={{ marginTop: 5, color: 'var(--text2)', fontSize: 12, lineHeight: 1.45 }}>
              {task.risk_reason}{task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}{task.due_date ? ` · due ${new Date(task.due_date).toLocaleDateString()}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DashboardAnalyticsPanel({ days = 30 }: { days?: number }) {
  const summaryQ = useQuery({ queryKey: ['dashboard-live-summary', days], queryFn: () => fetchSummary(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const trendQ = useQuery({ queryKey: ['dashboard-live-trend', days], queryFn: () => fetchTrend(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const statusQ = useQuery({ queryKey: ['dashboard-live-status', days], queryFn: () => fetchStatus(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const priorityQ = useQuery({ queryKey: ['dashboard-live-priority', days], queryFn: () => fetchPriority(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const projectQ = useQuery({ queryKey: ['dashboard-live-projects', days], queryFn: () => fetchProjects(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const workloadQ = useQuery({ queryKey: ['dashboard-live-workload', days], queryFn: () => fetchWorkload(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const slaQ = useQuery({ queryKey: ['dashboard-live-sla', days], queryFn: () => fetchSlaRisk(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })

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
      {hasError && <ErrorNotice />}
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
        <Card title="Live Activity Flow" subtitle="Backend-generated created, completed, and overdue trend">
          {trendQ.isLoading ? <Loading height={210} /> : <TrendMini points={trendQ.data || []} />}
        </Card>
        <Card title="Status + Priority Mix" subtitle="Current operational distribution">
          {statusQ.isLoading || priorityQ.isLoading ? <Loading /> : <StatusPriorityMatrix statuses={statusQ.data || []} priorities={priorityQ.data || []} />}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        <Card title="Project Workload" subtitle="Backend project-summary completion/open/overdue split">
          {projectQ.isLoading ? <Loading /> : <ProjectWorkload projects={projects} />}
        </Card>
        <Card title="Team Load" subtitle="Backend workload API by employee">
          {workloadQ.isLoading ? <Loading /> : <TeamLoad workload={workload} />}
        </Card>
        <Card title="SLA Risk Queue" subtitle="Due-soon, overdue, stalled, critical, and review backlog">
          {slaQ.isLoading ? <Loading /> : <RiskQueue sla={slaQ.data} />}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="miniCard"><Activity size={16} color="#38bdf8" /><strong>{trendQ.data?.length || 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>trend days loaded</span></div>
        <div className="miniCard"><Users size={16} color="#8b5cf6" /><strong>{activePeople}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>people in workload</span></div>
        <div className="miniCard"><AlertTriangle size={16} color="#ef4444" /><strong>{slaQ.data?.summary?.due_soon_72h ?? 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>tasks due within 72h</span></div>
      </div>
    </div>
  )
}
