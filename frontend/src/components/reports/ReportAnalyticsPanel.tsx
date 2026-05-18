import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileBarChart, FolderOpen, Users } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { KpiStrip } from '../ui/KpiCard'
import { AnalyticsCard, AnalyticsErrorNotice, AnalyticsLoadingBlock, AnalyticsRiskQueue, EmptyAnalyticsState, numberValue as n, percent as pct } from '../analytics/AnalyticsPrimitives'

type AnalyticsSummary = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  overdue_tasks: number
  active_employees: number
  avg_completion_hours?: string | number
  avg_ai_confidence?: string | number
}

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

type EmployeePerformance = {
  employee_id: string
  employee_name: string
  assigned: number
  completed: number
  overdue: number
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

async function fetchSummary(days: number) {
  return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`)
}

async function fetchProjects(days: number) {
  const data = await apiFetch<{ projects: ProjectSummary[] }>(`/api/v1/analytics/project-summary?days=${days}`)
  return data.projects || []
}

async function fetchDepartments(days: number) {
  const data = await apiFetch<{ departments: DepartmentPerformance[] }>(`/api/v1/analytics/department-performance?days=${days}`)
  return data.departments || []
}

async function fetchEmployees(days: number) {
  const data = await apiFetch<{ employees: EmployeePerformance[] }>(`/api/v1/analytics/employee-performance?days=${days}`)
  return data.employees || []
}

async function fetchSlaRisk(days: number) {
  return apiFetch<SlaRisk>(`/api/v1/analytics/sla-risk?days=${days}`)
}

function SnapshotReadiness({ summary, projects, departments, employees, sla }: {
  summary?: AnalyticsSummary
  projects: ProjectSummary[]
  departments: DepartmentPerformance[]
  employees: EmployeePerformance[]
  sla?: SlaRisk
}) {
  const items = [
    { label: 'Task summary', value: n(summary?.total_tasks), ok: n(summary?.total_tasks) > 0, color: '#38bdf8' },
    { label: 'Project analytics', value: projects.length, ok: projects.length > 0, color: '#e2ab41' },
    { label: 'Department analytics', value: departments.length, ok: departments.length > 0, color: '#8b5cf6' },
    { label: 'Employee analytics', value: employees.length, ok: employees.length > 0, color: '#22c55e' },
    { label: 'SLA risk scan', value: sla?.tasks?.length || 0, ok: true, color: '#f97316' },
  ]
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: item.ok ? item.color : '#94a3b8', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(148,163,184,.14)', marginTop: 6, overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: item.ok ? '100%' : '20%', background: item.ok ? item.color : '#94a3b8', borderRadius: 999 }} />
            </div>
          </div>
          <span className="pill pillMuted" style={{ color: item.ok ? item.color : '#94a3b8' }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function ProjectRows({ projects }: { projects: ProjectSummary[] }) {
  const rows = projects
    .filter((p) => n(p.total_tasks) > 0)
    .sort((a, b) => n(b.overdue_tasks) - n(a.overdue_tasks) || n(b.open_tasks) - n(a.open_tasks) || n(b.total_tasks) - n(a.total_tasks))
    .slice(0, 7)
  if (!rows.length) return <EmptyAnalyticsState title="No project report data" detail="No report analytics for the selected period." minHeight={116} />
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
              <span style={{ fontSize: 12, fontWeight: 950, color: overdue > 0 ? '#ef4444' : '#22c55e' }}>{pct(completed, total)}%</span>
            </div>
            <div style={{ width: `${Math.max(18, (total / max) * 100)}%`, maxWidth: '100%', display: 'flex', height: 10, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
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

function DepartmentRows({ departments }: { departments: DepartmentPerformance[] }) {
  const rows = departments
    .filter((d) => n(d.assigned_tasks) > 0 || n(d.employee_count) > 0)
    .sort((a, b) => n(b.assigned_tasks) - n(a.assigned_tasks))
    .slice(0, 7)
  if (!rows.length) return <EmptyAnalyticsState title="No department report data" detail="No report analytics for the selected period." minHeight={116} />
  const max = Math.max(1, ...rows.map((row) => n(row.assigned_tasks)))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => {
        const value = n(row.assigned_tasks)
        const color = n(row.overdue_tasks) > 0 ? '#ef4444' : '#38bdf8'
        return (
          <div key={row.department || 'Unassigned'} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 12 }}>{row.department || 'Unassigned'}</strong>
              <span style={{ color, fontSize: 12, fontWeight: 950 }}>{value}</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <i style={{ display: 'block', width: `${Math.max(4, value / max * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmployeeRows({ employees }: { employees: EmployeePerformance[] }) {
  const rows = employees
    .filter((e) => n(e.assigned) > 0 || n(e.completed) > 0)
    .map((e) => ({ ...e, rate: pct(n(e.completed), Math.max(n(e.assigned), n(e.completed))) }))
    .sort((a, b) => b.rate - a.rate || n(b.completed) - n(a.completed))
    .slice(0, 7)
  if (!rows.length) return <EmptyAnalyticsState title="No employee performance report data" detail="No report analytics for the selected period." minHeight={116} />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => {
        const color = row.rate >= 80 ? '#22c55e' : row.rate >= 55 ? '#e2ab41' : '#ef4444'
        return (
          <div key={row.employee_id || row.employee_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee_name}</strong>
              <span style={{ color, fontSize: 12, fontWeight: 950 }}>{row.rate}%</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <i style={{ display: 'block', width: `${Math.max(4, row.rate)}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ReportAnalyticsPanel({ days = 30 }: { days?: number }) {
  const summaryQ = useQuery({ queryKey: ['reports-analytics-summary', days], queryFn: () => fetchSummary(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const projectsQ = useQuery({ queryKey: ['reports-analytics-projects', days], queryFn: () => fetchProjects(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const departmentsQ = useQuery({ queryKey: ['reports-analytics-departments', days], queryFn: () => fetchDepartments(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const employeesQ = useQuery({ queryKey: ['reports-analytics-employees', days], queryFn: () => fetchEmployees(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const slaQ = useQuery({ queryKey: ['reports-analytics-sla', days], queryFn: () => fetchSlaRisk(days), staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })

  const summary = summaryQ.data
  const projects = projectsQ.data || []
  const departments = departmentsQ.data || []
  const employees = employeesQ.data || []
  const sla = slaQ.data
  const total = n(summary?.total_tasks)
  const completed = n(summary?.completed_tasks)
  const overdue = n(summary?.overdue_tasks)
  const completionRate = pct(completed, total)
  const openSla = n(sla?.summary?.open_tasks)
  const riskSignals = n(sla?.summary?.overdue_tasks) + n(sla?.summary?.due_soon_72h) + n(sla?.summary?.critical_priority_open) + n(sla?.summary?.stalled_pending) + n(sla?.summary?.review_backlog)
  const loading = summaryQ.isLoading || projectsQ.isLoading || departmentsQ.isLoading || employeesQ.isLoading || slaQ.isLoading
  const hasError = summaryQ.isError || projectsQ.isError || departmentsQ.isError || employeesQ.isError || slaQ.isError

  const reportReadiness = useMemo(() => {
    const parts = [total > 0, projects.length > 0, departments.length > 0, employees.length > 0, !!sla]
    return pct(parts.filter(Boolean).length, parts.length)
  }, [departments.length, employees.length, projects.length, sla, total])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {hasError && <AnalyticsErrorNotice message="Live report analytics failed to load. Existing report snapshots remain available and this panel will retry automatically." />}
      <KpiStrip
        loading={loading}
        skeletonCount={5}
        items={[
          { label: 'Report Readiness', value: `${reportReadiness}%`, color: reportReadiness >= 80 ? '#22c55e' : '#e2ab41', icon: <FileBarChart size={34} />, sub: 'live snapshot coverage' },
          { label: 'Tasks in Scope', value: total, color: '#38bdf8', icon: <BarChart3 size={34} />, sub: `${days}d analytics` },
          { label: 'Completion Rate', value: `${completionRate}%`, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${completed} completed` },
          { label: 'SLA Open', value: openSla, color: '#8b5cf6', icon: <Clock3 size={34} />, sub: 'open task risk base' },
          { label: 'Risk Signals', value: riskSignals, color: riskSignals ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: `${overdue} overdue` },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <AnalyticsCard title="Snapshot Readiness" subtitle="Which backend analytics sections can be included in generated reports">
          {loading ? <AnalyticsLoadingBlock height={160} /> : <SnapshotReadiness summary={summary} projects={projects} departments={departments} employees={employees} sla={sla} />}
        </AnalyticsCard>
        <AnalyticsCard title="SLA Risk Queue" subtitle="Tasks most likely to affect report outcomes">
          {slaQ.isLoading ? <AnalyticsLoadingBlock height={160} /> : <AnalyticsRiskQueue tasks={sla?.tasks} emptyTitle="No SLA risk report queue" emptyDetail="No overdue, due-soon, stalled, critical, or review-backlog task risk." />}
        </AnalyticsCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        <AnalyticsCard title="Project Report Coverage" subtitle="Project completion, open, and overdue mix">
          {projectsQ.isLoading ? <AnalyticsLoadingBlock height={160} /> : <ProjectRows projects={projects} />}
        </AnalyticsCard>
        <AnalyticsCard title="Department Report Coverage" subtitle="Task volume by department">
          {departmentsQ.isLoading ? <AnalyticsLoadingBlock height={160} /> : <DepartmentRows departments={departments} />}
        </AnalyticsCard>
        <AnalyticsCard title="Employee Report Coverage" subtitle="Completion rate by employee">
          {employeesQ.isLoading ? <AnalyticsLoadingBlock height={160} /> : <EmployeeRows employees={employees} />}
        </AnalyticsCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="miniCard"><FolderOpen size={16} color="#38bdf8" /><strong>{projects.length}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>projects in snapshot</span></div>
        <div className="miniCard"><Users size={16} color="#8b5cf6" /><strong>{employees.length}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>employees in snapshot</span></div>
        <div className="miniCard"><AlertTriangle size={16} color="#ef4444" /><strong>{sla?.summary?.critical_priority_open ?? 0}</strong><span style={{ color: 'var(--muted)', fontSize: 12 }}>critical priority open</span></div>
      </div>
    </div>
  )
}
