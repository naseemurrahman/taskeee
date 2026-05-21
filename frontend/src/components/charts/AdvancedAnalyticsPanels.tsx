import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRealtimeInvalidation } from '../../lib/socket'
import { apiFetch } from '../../lib/api'
import { ChartCard } from './ChartCard'

type ProjectSummary = {
  project_id: string
  project_name: string
  project_status?: string | null
  total_tasks: number
  completed_tasks: number
  open_tasks: number
  overdue_tasks: number
  high_priority_tasks: number
  completion_rate: number | null
  earliest_due_date?: string | null
  latest_due_date?: string | null
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

type EmployeeTrendPoint = {
  day: string
  employee_id: string
  employee_name: string
  assigned: number
  completed: number
  overdue: number
}

function num(value: unknown) {
  return Number(value || 0)
}

function BarRows({ rows, labelKey, valueKey, color = '#e2ab41', empty }: {
  rows: any[]
  labelKey: string
  valueKey: string
  color?: string
  empty: string
}) {
  const data = rows.filter((row) => num(row[valueKey]) > 0).slice(0, 8)
  const max = Math.max(1, ...data.map((row) => num(row[valueKey])))
  if (!data.length) return <EmptyState title={empty} />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((row) => {
        const value = num(row[valueKey])
        return (
          <div key={`${row[labelKey]}-${value}`} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 850, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row[labelKey] || 'Unassigned'}</span>
              <span style={{ fontSize: 13, fontWeight: 950, color }}>{value}</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(4, (value / max) * 100)}%`, background: color, borderRadius: 999 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyState({ title, detail = 'No records for the selected period.' }: { title: string; detail?: string }) {
  return (
    <div style={{ minHeight: 120, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 900 }}>{title}</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>{detail}</div>
      </div>
    </div>
  )
}

function ErrorState() {
  return <div className="alertV4 alertV4Error">This live analytics panel failed to load. It will retry automatically.</div>
}

function MetricTile({ label, value, color, detail }: { label: string; value: string | number; color: string; detail?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 14, background: `${color}12`, border: `1px solid ${color}28`, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 950, color: 'var(--text)', marginTop: 4 }}>{value}</div>
      {detail ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{detail}</div> : null}
    </div>
  )
}

function RiskTasks({ data }: { data?: SlaRisk }) {
  if (!data?.tasks?.length) return <EmptyState title="No SLA risk tasks" detail="Open tasks do not currently trigger SLA risk thresholds." />
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {data.tasks.slice(0, 6).map((task) => {
        const color = task.risk_score >= 80 ? '#ef4444' : task.risk_score >= 50 ? '#f97316' : '#e2ab41'
        return (
          <div key={task.task_id || task.title} className="miniCard" style={{ borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ fontWeight: 900, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
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

function EmployeeTrend({ points }: { points: EmployeeTrendPoint[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { employee_name: string; assigned: number; completed: number; overdue: number }>()
    for (const point of points || []) {
      const key = point.employee_id || point.employee_name
      const current = map.get(key) || { employee_name: point.employee_name || 'Unassigned', assigned: 0, completed: 0, overdue: 0 }
      current.assigned += num(point.assigned)
      current.completed += num(point.completed)
      current.overdue += num(point.overdue)
      map.set(key, current)
    }
    return Array.from(map.values()).sort((a, b) => b.completed - a.completed || b.assigned - a.assigned).slice(0, 8)
  }, [points])

  if (!rows.length) return <EmptyState title="No employee trend data" />
  const max = Math.max(1, ...rows.flatMap((row) => [row.assigned, row.completed, row.overdue]))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => (
        <div key={row.employee_name} style={{ display: 'grid', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 900 }}>{row.employee_name}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800 }}>{row.completed}/{row.assigned} complete</span>
          </div>
          <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(148,163,184,.14)' }}>
            <i style={{ width: `${Math.max(0, row.completed / max * 100)}%`, background: '#22c55e' }} />
            <i style={{ width: `${Math.max(0, row.overdue / max * 100)}%`, background: '#ef4444' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdvancedAnalyticsPanels({ days }: { days: number }) {
  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })
  const projectQ = useQuery({ queryKey: ['analytics-project-summary', days], queryFn: () => apiFetch<{ projects: ProjectSummary[] }>(`/api/v1/analytics/project-summary?days=${days}`), staleTime: 30_000, refetchInterval: 30_000 })
  const departmentQ = useQuery({ queryKey: ['analytics-department-performance', days], queryFn: () => apiFetch<{ departments: DepartmentPerformance[] }>(`/api/v1/analytics/department-performance?days=${days}`), staleTime: 30_000, refetchInterval: 30_000 })
  const employeeTrendQ = useQuery({ queryKey: ['analytics-employee-trend', days], queryFn: () => apiFetch<{ points: EmployeeTrendPoint[] }>(`/api/v1/analytics/employee-trend?days=${days}`), staleTime: 30_000, refetchInterval: 30_000 })
  const slaQ = useQuery({ queryKey: ['analytics-sla-risk', days], queryFn: () => apiFetch<SlaRisk>(`/api/v1/analytics/sla-risk?days=${days}`), staleTime: 30_000, refetchInterval: 30_000 })

  const projects = projectQ.data?.projects || []
  const departments = departmentQ.data?.departments || []
  const sla = slaQ.data
  const topProjects = projects.slice().sort((a, b) => num(b.open_tasks) - num(a.open_tasks) || num(b.overdue_tasks) - num(a.overdue_tasks))
  const riskSummary = sla?.summary

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <ChartCard title="Backend Analytics Coverage" subtitle="Project, department, employee trend, and SLA-risk APIs" loading={projectQ.isLoading || departmentQ.isLoading || slaQ.isLoading}>
        {projectQ.isError || departmentQ.isError || slaQ.isError ? <ErrorState /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <MetricTile label="Projects tracked" value={projects.length} color="#38bdf8" detail="from project-summary" />
            <MetricTile label="Departments" value={departments.length} color="#8b5cf6" detail="from department-performance" />
            <MetricTile label="Due soon" value={riskSummary?.due_soon_72h ?? 0} color="#f97316" detail="within 72h" />
            <MetricTile label="Stalled pending" value={riskSummary?.stalled_pending ?? 0} color="#ef4444" detail="pending over 3 days" />
          </div>
        )}
      </ChartCard>

      <div className="analyticsChartGrid">
        <ChartCard title="Project Risk Load" subtitle="Open task load by project/category" loading={projectQ.isLoading}>
          {projectQ.isError ? <ErrorState /> : <BarRows rows={topProjects} labelKey="project_name" valueKey="open_tasks" color="#38bdf8" empty="No project workload data" />}
        </ChartCard>
        <ChartCard title="Department Performance" subtitle="Completed tasks by department" loading={departmentQ.isLoading}>
          {departmentQ.isError ? <ErrorState /> : <BarRows rows={departments} labelKey="department" valueKey="completed_tasks" color="#22c55e" empty="No department performance data" />}
        </ChartCard>
      </div>

      <div className="analyticsChartGrid">
        <ChartCard title="Employee Delivery Trend" subtitle="Backend-generated employee trend summary" loading={employeeTrendQ.isLoading}>
          {employeeTrendQ.isError ? <ErrorState /> : <EmployeeTrend points={employeeTrendQ.data?.points || []} />}
        </ChartCard>
        <ChartCard title="SLA Risk Queue" subtitle="Overdue, due-soon, stalled, critical, and review backlog" loading={slaQ.isLoading}>
          {slaQ.isError ? <ErrorState /> : <RiskTasks data={sla} />}
        </ChartCard>
      </div>
    </div>
  )
}
