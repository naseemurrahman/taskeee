import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Clock3, LineChart, Users, UserCheck } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { KpiStrip } from '../ui/KpiCard'

type EmployeePerformance = {
  employee_id: string
  employee_name: string
  assigned: number
  completed: number
  overdue: number
}

type EmployeeTrendPoint = {
  day: string
  employee_id: string
  employee_name: string
  assigned: number
  completed: number
  overdue: number
}

type WorkloadEmployee = {
  employee_id: string
  employee_name: string
  open_tasks: number
  total_tasks: number
}

type DepartmentPerformance = {
  department: string
  employee_count: number
  assigned_tasks: number
  completed_tasks: number
  open_tasks: number
  overdue_tasks: number
  completion_rate: number | null
  avg_open_tasks: number | null
}

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

async function fetchEmployeePerformance(days: number) {
  const data = await apiFetch<{ employees: EmployeePerformance[] }>(`/api/v1/analytics/employee-performance?days=${days}`)
  return data.employees || []
}

async function fetchEmployeeTrend(days: number) {
  const data = await apiFetch<{ points: EmployeeTrendPoint[] }>(`/api/v1/analytics/employee-trend?days=${days}`)
  return data.points || []
}

async function fetchWorkload(days: number) {
  const data = await apiFetch<{ employees: WorkloadEmployee[] }>(`/api/v1/analytics/workload?days=${days}`)
  return data.employees || []
}

async function fetchDepartmentPerformance(days: number) {
  const data = await apiFetch<{ departments: DepartmentPerformance[] }>(`/api/v1/analytics/department-performance?days=${days}`)
  return data.departments || []
}

async function fetchSlaRisk(days: number) {
  return apiFetch<SlaRisk>(`/api/v1/analytics/sla-risk?days=${days}`)
}

function Empty({ title, detail = 'No employee analytics for the selected period.' }: { title: string; detail?: string }) {
  return (
    <div style={{ minHeight: 120, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
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
        <div style={{ fontSize: 14, fontWeight: 950, color: 'var(--text)' }}>{title}</div>
        {subtitle ? <div style={{ marginTop: 2, fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

function ErrorNotice() {
  return <div className="alertV4 alertV4Error">Employee analytics failed to load. Visible data remains available and the app will retry automatically.</div>
}

function LoadingBlock({ height = 180 }: { height?: number }) {
  return <div className="skeleton" style={{ height, borderRadius: 14 }} />
}

function DeliveryScoreRows({ rows }: { rows: EmployeePerformance[] }) {
  const data = rows
    .filter((row) => n(row.assigned) > 0 || n(row.completed) > 0)
    .map((row) => {
      const assigned = n(row.assigned)
      const completed = n(row.completed)
      const overdue = n(row.overdue)
      const completionRate = pct(completed, Math.max(assigned, completed + overdue))
      const score = Math.max(0, Math.min(100, Math.round(completionRate - (assigned ? overdue / assigned * 35 : 0))))
      return { ...row, assigned, completed, overdue, completionRate, score }
    })
    .sort((a, b) => b.score - a.score || b.completed - a.completed)
    .slice(0, 8)

  if (!data.length) return <Empty title="No delivery score data" />

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((row) => {
        const color = row.score >= 80 ? '#22c55e' : row.score >= 55 ? '#e2ab41' : '#ef4444'
        return (
          <div key={row.employee_id || row.employee_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee_name || 'Unassigned'}</span>
              <span style={{ fontSize: 12, fontWeight: 950, color }}>{row.score}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(4, row.score)}%`, height: '100%', borderRadius: 999, background: color }} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>
              <span>{row.completed} completed</span><span>{row.assigned} assigned</span>{row.overdue > 0 ? <span style={{ color: '#ef4444' }}>{row.overdue} overdue</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WorkloadRows({ rows }: { rows: WorkloadEmployee[] }) {
  const data = rows
    .filter((row) => n(row.total_tasks) > 0 || n(row.open_tasks) > 0)
    .sort((a, b) => n(b.open_tasks) - n(a.open_tasks) || n(b.total_tasks) - n(a.total_tasks))
    .slice(0, 8)
  const maxOpen = Math.max(1, ...data.map((row) => n(row.open_tasks)))
  if (!data.length) return <Empty title="No workload data" />

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((row) => {
        const open = n(row.open_tasks)
        const total = Math.max(1, n(row.total_tasks))
        const completed = Math.max(0, total - open)
        const pressure = pct(open, maxOpen)
        const color = pressure > 75 ? '#ef4444' : pressure > 45 ? '#f97316' : '#22c55e'
        return (
          <div key={row.employee_id || row.employee_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee_name || 'Unassigned'}</span>
              <span style={{ color, fontSize: 12, fontWeight: 950 }}>{open} open</span>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <i style={{ width: `${pct(completed, total)}%`, background: '#22c55e' }} />
              <i style={{ width: `${pct(open, total)}%`, background: color }} />
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,.12)', overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${pressure}%`, background: color, borderRadius: 999 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DepartmentRows({ rows }: { rows: DepartmentPerformance[] }) {
  const data = rows
    .filter((row) => n(row.assigned_tasks) > 0 || n(row.employee_count) > 0)
    .sort((a, b) => n(b.completed_tasks) - n(a.completed_tasks) || n(b.assigned_tasks) - n(a.assigned_tasks))
    .slice(0, 8)
  const max = Math.max(1, ...data.map((row) => Math.max(n(row.completed_tasks), n(row.open_tasks), n(row.overdue_tasks))))
  if (!data.length) return <Empty title="No department analytics" />

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((row) => {
        const completed = n(row.completed_tasks)
        const open = n(row.open_tasks)
        const overdue = n(row.overdue_tasks)
        return (
          <div key={row.department || 'Unassigned'} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{row.department || 'Unassigned'}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800 }}>{row.employee_count} people</span>
            </div>
            <div style={{ display: 'flex', height: 10, background: 'rgba(148,163,184,.14)', borderRadius: 999, overflow: 'hidden' }}>
              <i style={{ width: `${completed / max * 100}%`, background: '#22c55e' }} />
              <i style={{ width: `${open / max * 100}%`, background: '#8b5cf6' }} />
              <i style={{ width: `${overdue / max * 100}%`, background: '#ef4444' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, fontWeight: 800, color: 'var(--muted)' }}>
              <span>{completed} done</span><span>{open} open</span>{overdue > 0 ? <span style={{ color: '#ef4444' }}>{overdue} overdue</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TrendSvg({ points }: { points: EmployeeTrendPoint[] }) {
  const totals = useMemo(() => {
    const byDay = new Map<string, { day: string; assigned: number; completed: number; overdue: number }>()
    for (const point of points || []) {
      const day = String(point.day || '').slice(5, 10)
      const current = byDay.get(day) || { day, assigned: 0, completed: 0, overdue: 0 }
      current.assigned += n(point.assigned)
      current.completed += n(point.completed)
      current.overdue += n(point.overdue)
      byDay.set(day, current)
    }
    return Array.from(byDay.values())
  }, [points])
  const total = totals.reduce((sum, row) => sum + row.assigned + row.completed + row.overdue, 0)
  if (!totals.length || total === 0) return <Empty title="No employee trend movement" detail="Assigned, completed, and overdue movement will appear when tasks change." />

  const W = 720, H = 230, L = 34, R = 14, T = 16, B = 34
  const max = Math.max(1, ...totals.flatMap((row) => [row.assigned, row.completed, row.overdue]))
  const x = (i: number) => L + i * (W - L - R) / Math.max(1, totals.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const path = (key: 'assigned' | 'completed' | 'overdue') => totals.map((row, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(row[key])}`).join(' ')
  const tickEvery = Math.max(1, Math.ceil(totals.length / 6))

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="230" role="img" aria-label="Employee delivery trend">
        {[0, .25, .5, .75, 1].map((tick) => {
          const yy = T + tick * (H - T - B)
          return <line key={tick} x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(148,163,184,.16)" strokeDasharray="4 4" />
        })}
        <path d={path('assigned')} fill="none" stroke="#e2ab41" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('completed')} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('overdue')} fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
        {totals.map((row, i) => i % tickEvery === 0 || i === totals.length - 1 ? <text key={row.day} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--muted)">{row.day}</text> : null)}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', fontSize: 11, fontWeight: 800 }}>
        <span style={{ color: '#e2ab41' }}>● Assigned</span><span style={{ color: '#22c55e' }}>● Completed</span><span style={{ color: '#ef4444' }}>● Overdue</span>
      </div>
    </div>
  )
}

function SlaRiskQueue({ data }: { data?: SlaRisk }) {
  if (!data?.tasks?.length) return <Empty title="No employee SLA risk queue" detail="No overdue, due-soon, stalled, critical, or review-backlog tasks." />
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {data.tasks.slice(0, 6).map((task) => {
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

export function EmployeeAnalyticsPanel({ days = 30 }: { days?: number }) {
  const performanceQ = useQuery({ queryKey: ['employees-analytics-performance', days], queryFn: () => fetchEmployeePerformance(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const trendQ = useQuery({ queryKey: ['employees-analytics-trend', days], queryFn: () => fetchEmployeeTrend(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const workloadQ = useQuery({ queryKey: ['employees-analytics-workload', days], queryFn: () => fetchWorkload(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const departmentQ = useQuery({ queryKey: ['employees-analytics-departments', days], queryFn: () => fetchDepartmentPerformance(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const slaQ = useQuery({ queryKey: ['employees-analytics-sla', days], queryFn: () => fetchSlaRisk(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })

  const performance = performanceQ.data || []
  const workload = workloadQ.data || []
  const departments = departmentQ.data || []
  const totalAssigned = performance.reduce((s, row) => s + n(row.assigned), 0)
  const totalCompleted = performance.reduce((s, row) => s + n(row.completed), 0)
  const totalOverdue = performance.reduce((s, row) => s + n(row.overdue), 0)
  const openTasks = workload.reduce((s, row) => s + n(row.open_tasks), 0)
  const activePeople = workload.filter((row) => n(row.total_tasks) > 0 || n(row.open_tasks) > 0).length
  const completionRate = pct(totalCompleted, totalAssigned)
  const avgOpen = activePeople ? (openTasks / activePeople).toFixed(1) : '0.0'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {(performanceQ.isError || trendQ.isError || workloadQ.isError || departmentQ.isError || slaQ.isError) && <ErrorNotice />}
      <KpiStrip
        loading={performanceQ.isLoading || workloadQ.isLoading}
        skeletonCount={5}
        items={[
          { label: 'People With Tasks', value: activePeople, color: '#38bdf8', icon: <Users size={34} />, sub: 'backend workload' },
          { label: 'Assigned Tasks', value: totalAssigned, color: '#e2ab41', icon: <BriefcaseBusiness size={34} />, sub: `${days}d scope` },
          { label: 'Completed', value: totalCompleted, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${completionRate}% rate` },
          { label: 'Open / Person', value: avgOpen, color: '#8b5cf6', icon: <LineChart size={34} />, sub: `${openTasks} open` },
          { label: 'Overdue', value: totalOverdue, color: totalOverdue ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: 'employee risk' },
        ]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <Card title="Employee Delivery Scores" subtitle="Backend employee-performance endpoint">
          {performanceQ.isLoading ? <LoadingBlock /> : <DeliveryScoreRows rows={performance} />}
        </Card>
        <Card title="Workload Pressure" subtitle="Open/completed split and relative pressure">
          {workloadQ.isLoading ? <LoadingBlock /> : <WorkloadRows rows={workload} />}
        </Card>
      </div>
      <Card title="Employee Trend" subtitle="Assigned, completed, and overdue movement over the last 30 days">
        {trendQ.isLoading ? <LoadingBlock height={230} /> : <TrendSvg points={trendQ.data || []} />}
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <Card title="Department Performance" subtitle="Department-level completion/open/overdue mix">
          {departmentQ.isLoading ? <LoadingBlock /> : <DepartmentRows rows={departments} />}
        </Card>
        <Card title="Employee SLA Risk Queue" subtitle="Due-soon, overdue, stalled, critical, and review-backlog tasks">
          {slaQ.isLoading ? <LoadingBlock /> : <SlaRiskQueue data={slaQ.data} />}
        </Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="miniCard"><UserCheck size={16} color="#22c55e" /><strong>{departments.length}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>departments tracked</span></div>
        <div className="miniCard"><Clock3 size={16} color="#f97316" /><strong>{slaQ.data?.summary?.due_soon_72h ?? 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>tasks due within 72h</span></div>
        <div className="miniCard"><AlertTriangle size={16} color="#ef4444" /><strong>{slaQ.data?.summary?.stalled_pending ?? 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>stalled pending tasks</span></div>
      </div>
    </div>
  )
}
