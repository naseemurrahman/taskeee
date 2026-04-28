import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, StatusDonutChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'

type Insight = { id: string; title: string; description: string; severity: 'low' | 'medium' | 'high' | 'critical'; recommendation: string }
type InsightsResponse = { generated_at: string; insights: Insight[] }
type AnalyticsSummary = { total_tasks: number; completed_tasks: number; pending_tasks: number; overdue_tasks: number; active_employees: number; avg_completion_hours: string | number; avg_ai_confidence: string | number }
type StatusPoint = { status: string; count: number }
type TrendPoint = { day: string; created?: number; completed?: number; overdue?: number }
type EmployeePerformance = { employee_id: string; employee_name: string; assigned: number; completed: number; overdue: number }
type WorkloadEmployee = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }

async function fetchInsights(days: number) { return apiFetch<InsightsResponse>(`/api/v1/insights/overview?days=${days}`) }
async function fetchSummary(days: number) { return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`) }
async function fetchStatus(days: number) { return apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?days=${days}`) }
async function fetchTrend(days: number) { return apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?days=${days}`) }
async function fetchEmployees(days: number) { return apiFetch<{ employees: EmployeePerformance[] }>(`/api/v1/analytics/employee-performance?days=${days}`) }
async function fetchWorkload(days: number) { return apiFetch<{ employees: WorkloadEmployee[] }>(`/api/v1/analytics/workload?days=${days}`) }

function severityColor(severity: Insight['severity']) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'high') return '#f97316'
  if (severity === 'medium') return '#f4ca57'
  return '#22c55e'
}

function toNumber(value: string | number | undefined | null) { return Number(value || 0) }
function statusMap(points: StatusPoint[] = []) { return Object.fromEntries(points.map((p) => [p.status, Number(p.count || 0)])) }

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const insightsQ = useQuery({ queryKey: ['insights', days], queryFn: () => fetchInsights(days) })
  const summaryQ = useQuery({ queryKey: ['analytics-summary', days], queryFn: () => fetchSummary(days) })
  const statusQ = useQuery({ queryKey: ['analytics-status', days], queryFn: () => fetchStatus(days) })
  const trendQ = useQuery({ queryKey: ['analytics-trend', days], queryFn: () => fetchTrend(days) })
  const employeesQ = useQuery({ queryKey: ['analytics-employees', days], queryFn: () => fetchEmployees(days) })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', days], queryFn: () => fetchWorkload(days) })

  const summary = summaryQ.data
  const byStatus = useMemo(() => statusMap(statusQ.data?.statuses), [statusQ.data])
  const trend = trendQ.data?.points || []
  const employees = employeesQ.data?.employees || []
  const workloadEmployees = workloadQ.data?.employees || []
  const total = Number(summary?.total_tasks || 0)
  const completed = Number(summary?.completed_tasks || 0)
  const pending = Number(summary?.pending_tasks || 0)
  const overdue = Number(summary?.overdue_tasks || 0)
  const completionRate = total ? Math.round((completed / total) * 100) : 0
  const avgHours = toNumber(summary?.avg_completion_hours)
  const avgConfidence = toNumber(summary?.avg_ai_confidence)

  const workload = useMemo(() => {
    const avg = workloadEmployees.length ? workloadEmployees.reduce((s, e) => s + Number(e.open_tasks || 0), 0) / workloadEmployees.length : 0
    return {
      averageOpenTasks: avg,
      overloaded: workloadEmployees.filter((e) => Number(e.open_tasks || 0) > Math.max(5, avg * 1.5)),
      underutilized: workloadEmployees.filter((e) => Number(e.open_tasks || 0) <= Math.max(1, avg * 0.35)),
    }
  }, [workloadEmployees])

  const performanceRows = employees.map((e) => {
    const assigned = Number(e.assigned || 0)
    const done = Number(e.completed || 0)
    const late = Number(e.overdue || 0)
    const score = assigned ? Math.max(0, Math.round((done / assigned) * 100 - (late / assigned) * 35)) : 0
    return { name: e.employee_name || 'Unassigned', active: Math.max(0, assigned - done), completed: done, performanceScore: score }
  })

  const priorityPlaceholder = { high: overdue, medium: pending, low: Math.max(0, total - pending - overdue - completed) }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Analytics Intelligence</div>
            <div className="pageHeaderCardSub">AI insights, executive KPIs, workload analytics, and professional operational charts.</div>
          </div>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <ChartCard title="AI Insights" subtitle="Prioritized risks and recommendations from the insights engine.">
        {insightsQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading insights…</div> : null}
        {insightsQ.isError ? <div className="alertV4 alertV4Error">Failed to load AI insights.</div> : null}
        {!insightsQ.isLoading && !insightsQ.isError && (insightsQ.data?.insights.length || 0) === 0 ? <div style={{ color: 'var(--text2)' }}>No major risks detected.</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {(insightsQ.data?.insights || []).slice(0, 6).map((insight) => {
            const color = severityColor(insight.severity)
            return (
              <div key={insight.id} className="miniCard" style={{ borderLeft: `4px solid ${color}`, background: `${color}14` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900 }}>{insight.title}</div>
                  <span className="pill pillMuted" style={{ color }}>{insight.severity.toUpperCase()}</span>
                </div>
                <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>{insight.description}</div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 750 }}>Recommendation: {insight.recommendation}</div>
              </div>
            )
          })}
        </div>
      </ChartCard>

      <div className="grid4">
        <div className="miniCard"><div className="miniLabel">Total tasks</div><div className="miniValue">{summaryQ.isLoading ? '—' : total}</div></div>
        <div className="miniCard"><div className="miniLabel">Completion rate</div><div className="miniValue">{completionRate}%</div></div>
        <div className="miniCard"><div className="miniLabel">Pending</div><div className="miniValue">{pending}</div></div>
        <div className="miniCard"><div className="miniLabel">Overdue</div><div className="miniValue" style={{ color: 'rgba(239,68,68,.92)' }}>{overdue}</div></div>
        <div className="miniCard"><div className="miniLabel">Active employees</div><div className="miniValue">{summary?.active_employees ?? 0}</div></div>
        <div className="miniCard"><div className="miniLabel">Avg completion</div><div className="miniValue">{avgHours ? `${avgHours.toFixed(1)}h` : '—'}</div></div>
        <div className="miniCard"><div className="miniLabel">AI confidence</div><div className="miniValue">{avgConfidence ? `${Math.round(avgConfidence * 100)}%` : '—'}</div></div>
        <div className="miniCard"><div className="miniLabel">Avg workload</div><div className="miniValue">{workload.averageOpenTasks.toFixed(1)}</div></div>
      </div>

      <div className="grid2">
        <ChartCard title="Task status distribution" subtitle="Current task mix by lifecycle state."><StatusDonutChart byStatus={byStatus} /></ChartCard>
        <ChartCard title="Tasks by status" subtitle="Operational workload grouped by status."><StatusBarChart byStatus={byStatus} /></ChartCard>
      </div>
      <div className="grid2">
        <ChartCard title="Created / completed / overdue trend" subtitle={`Daily trend across the last ${days} days.`}><DeadlinesTrendChart points={trend.map((p) => ({ day: String(p.day).slice(5, 10), due: Number(p.created || 0), overdue: Number(p.overdue || 0) }))} /></ChartCard>
        <ChartCard title="Priority pressure" subtitle="Risk-weighted work pressure inferred from current task state."><PriorityPieChart byPriority={priorityPlaceholder} /></ChartCard>
      </div>
      <div className="grid2">
        <ChartCard title="Workload balance" subtitle="Overloaded, balanced, and underutilized team members."><WorkloadBalanceChart userCount={workloadEmployees.length} workload={workload} /></ChartCard>
        <ChartCard title="Employee performance" subtitle="Completion and delivery score by employee."><AssigneeScoreChart rows={performanceRows} /></ChartCard>
      </div>
    </div>
  )
}
