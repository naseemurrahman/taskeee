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

type RiskSignal = { title: string; detail: string; score: number; severity: Insight['severity']; action: string }
type Redistribution = { from: string; to: string; tasks: number; reason: string }
type BackendAiOverview = {
  generated_at: string
  predictive_risks: RiskSignal[]
  risk_tasks: Array<{ task_id: string; title: string; risk_score: number; severity: Insight['severity']; reason: string; suggestion: string; assigned_to_name?: string; due_date?: string; priority?: string; status?: string }>
  suggestions: string[]
  workload_redistribution: Redistribution[]
  data_quality?: { confidence_available?: boolean; open_tasks_scored?: number }
}

async function fetchInsights(days: number) { return apiFetch<InsightsResponse>(`/api/v1/insights/overview?days=${days}`) }
async function fetchSummary(days: number) { return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`) }
async function fetchStatus(days: number) { return apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?days=${days}`) }
async function fetchTrend(days: number) { return apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?days=${days}`) }
async function fetchEmployees(days: number) { return apiFetch<{ employees: EmployeePerformance[] }>(`/api/v1/analytics/employee-performance?days=${days}`) }
async function fetchWorkload(days: number) { return apiFetch<{ employees: WorkloadEmployee[] }>(`/api/v1/analytics/workload?days=${days}`) }
async function fetchBackendAi(days: number) { return apiFetch<BackendAiOverview>(`/api/v1/ai/predictive-overview?days=${days}`) }

function severityColor(severity: Insight['severity']) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'high') return '#f97316'
  if (severity === 'medium') return '#f4ca57'
  return '#22c55e'
}

function riskSeverity(score: number): Insight['severity'] {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

function toNumber(value: string | number | undefined | null) { return Number(value || 0) }
function statusMap(points: StatusPoint[] = []) { return Object.fromEntries(points.map((p) => [p.status, Number(p.count || 0)])) }
function hasMetric(value: unknown) { return value !== null && value !== undefined && Number(value) > 0 }

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const insightsQ = useQuery({ queryKey: ['insights', days], queryFn: () => fetchInsights(days) })
  const summaryQ = useQuery({ queryKey: ['analytics-summary', days], queryFn: () => fetchSummary(days) })
  const statusQ = useQuery({ queryKey: ['analytics-status', days], queryFn: () => fetchStatus(days) })
  const trendQ = useQuery({ queryKey: ['analytics-trend', days], queryFn: () => fetchTrend(days) })
  const employeesQ = useQuery({ queryKey: ['analytics-employees', days], queryFn: () => fetchEmployees(days) })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', days], queryFn: () => fetchWorkload(days) })
  const backendAiQ = useQuery({ queryKey: ['backend-ai-overview', days], queryFn: () => fetchBackendAi(days), retry: false })

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
  const overdueRate = total ? Math.round((overdue / total) * 100) : 0
  const avgHours = toNumber(summary?.avg_completion_hours)
  const avgConfidenceAvailable = hasMetric(summary?.avg_ai_confidence)
  const avgConfidence = avgConfidenceAvailable ? toNumber(summary?.avg_ai_confidence) : 0

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

  const priorityPressure = {
    high: overdue,
    medium: Math.max(0, pending - overdue),
    low: Math.max(0, total - pending - completed),
  }

  const fallbackPredictiveRisks = useMemo<RiskSignal[]>(() => {
    const latest = trend.slice(-7)
    const recentCreated = latest.reduce((s, p) => s + Number(p.created || 0), 0)
    const recentCompleted = latest.reduce((s, p) => s + Number(p.completed || 0), 0)
    const backlogVelocityGap = Math.max(0, recentCreated - recentCompleted)
    const deliveryPressure = Math.min(100, Math.round(overdueRate * 1.2 + backlogVelocityGap * 8 + Math.max(0, 75 - completionRate) * 0.7))
    const workloadPressure = Math.min(100, Math.round((workload.overloaded.length * 22) + Math.max(0, workload.averageOpenTasks - 4) * 8))
    const aiConfidenceRisk = avgConfidenceAvailable ? Math.min(100, Math.round(Math.max(0, 0.78 - avgConfidence) * 130)) : 0

    return [
      {
        title: 'Deadline risk prediction',
        detail: `${overdue} overdue tasks, ${pending} open tasks, and ${backlogVelocityGap} net new tasks in the recent trend window.`,
        score: deliveryPressure,
        severity: riskSeverity(deliveryPressure),
        action: deliveryPressure >= 65 ? 'Freeze low-priority intake and focus the team on overdue/high-risk tasks.' : 'Maintain current execution cadence and monitor overdue trend daily.',
      },
      {
        title: 'Capacity risk prediction',
        detail: `${workload.overloaded.length} overloaded people, ${workload.underutilized.length} underutilized people, ${workload.averageOpenTasks.toFixed(1)} average open tasks/person.`,
        score: workloadPressure,
        severity: riskSeverity(workloadPressure),
        action: workloadPressure >= 65 ? 'Rebalance tasks from overloaded users to underutilized users before assigning new work.' : 'Capacity is acceptable; keep workload distribution visible during planning.',
      },
      {
        title: 'AI confidence risk',
        detail: avgConfidenceAvailable ? `Average AI confidence is ${Math.round(avgConfidence * 100)}%.` : 'AI confidence data is not yet available for this period.',
        score: aiConfidenceRisk,
        severity: avgConfidenceAvailable ? riskSeverity(aiConfidenceRisk) : 'low',
        action: avgConfidenceAvailable && aiConfidenceRisk >= 40 ? 'Review low-confidence AI decisions manually and add task context before automation.' : 'No AI-confidence alarm. Continue collecting confidence signals.',
      },
    ]
  }, [avgConfidence, avgConfidenceAvailable, completionRate, overdue, overdueRate, pending, trend, workload.averageOpenTasks, workload.overloaded.length, workload.underutilized.length])

  const fallbackSuggestions = useMemo(() => {
    const lowPerformers = performanceRows.filter((r) => r.performanceScore < 60 && (r.active || r.completed)).slice(0, 3)
    const strongest = performanceRows.slice().sort((a, b) => b.performanceScore - a.performanceScore)[0]
    const suggestions = [
      overdue > 0 ? `Escalate ${overdue} overdue task${overdue === 1 ? '' : 's'} and require owner updates before end of day.` : 'No overdue escalation needed right now.',
      workload.overloaded.length > 0 ? `Move 1-2 open tasks from overloaded people before creating more assignments.` : 'Workload distribution is currently stable.',
      strongest ? `Use ${strongest.name} as a template owner for similar work; current delivery score is ${strongest.performanceScore}%.` : 'Assign owners consistently so employee-level recommendations become stronger.',
      lowPerformers.length > 0 ? `Coach ${lowPerformers.map((p) => p.name).join(', ')} with smaller task batches and clearer due dates.` : 'No low delivery-score coaching signal detected.',
    ]
    return suggestions
  }, [overdue, performanceRows, workload.overloaded.length])

  const fallbackRedistribution = useMemo<Redistribution[]>(() => {
    const overloaded = workloadEmployees.slice().sort((a, b) => Number(b.open_tasks || 0) - Number(a.open_tasks || 0)).filter((e) => Number(e.open_tasks || 0) > Math.max(5, workload.averageOpenTasks * 1.5))
    const underutilized = workloadEmployees.slice().sort((a, b) => Number(a.open_tasks || 0) - Number(b.open_tasks || 0)).filter((e) => Number(e.open_tasks || 0) <= Math.max(1, workload.averageOpenTasks * 0.35))
    return overloaded.slice(0, 3).map((from, index) => {
      const to = underutilized[index % Math.max(underutilized.length, 1)]
      return {
        from: from.employee_name || 'Overloaded owner',
        to: to?.employee_name || 'next available owner',
        tasks: Math.max(1, Math.min(3, Math.round((Number(from.open_tasks || 0) - workload.averageOpenTasks) / 2))),
        reason: `${from.employee_name || 'This owner'} has ${from.open_tasks} open tasks versus ${workload.averageOpenTasks.toFixed(1)} team average.`,
      }
    })
  }, [workload.averageOpenTasks, workloadEmployees])

  const backendAi = backendAiQ.data
  const predictiveRisks = backendAi?.predictive_risks?.length ? backendAi.predictive_risks : fallbackPredictiveRisks
  const aiSuggestions = backendAi?.suggestions?.length ? backendAi.suggestions : fallbackSuggestions
  const redistribution = backendAi?.workload_redistribution?.length ? backendAi.workload_redistribution : fallbackRedistribution
  const riskTasks = backendAi?.risk_tasks || []
  const usingBackendAi = !!backendAi

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Analytics Intelligence</div>
            <div className="pageHeaderCardSub">AI insights, executive KPIs, workload analytics, prediction signals, and professional operational charts.</div>
          </div>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <ChartCard title="Predictive Intelligence" subtitle={usingBackendAi ? 'Backend-powered operational risk intelligence from live task data.' : 'Fallback prediction mode until backend AI deploy is available.'}>
        {backendAiQ.isLoading ? <div style={{ color: 'var(--text2)', marginBottom: 10 }}>Loading backend AI intelligence…</div> : null}
        {backendAiQ.isError ? <div className="alertV4 alertV4Error" style={{ marginBottom: 12 }}>Backend AI is not available yet. Showing safe local predictions.</div> : null}
        <div className="grid3">
          {predictiveRisks.map((risk) => {
            const color = severityColor(risk.severity)
            return (
              <div key={risk.title} className="miniCard" style={{ borderTop: `4px solid ${color}`, background: `${color}10` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontWeight: 950 }}>{risk.title}</div>
                  <span className="pill pillMuted" style={{ color }}>{risk.score}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden', marginTop: 12 }}>
                  <div style={{ height: '100%', width: `${risk.score}%`, background: color, borderRadius: 999 }} />
                </div>
                <div style={{ marginTop: 10, color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>{risk.detail}</div>
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800 }}>Action: {risk.action}</div>
              </div>
            )
          })}
        </div>
      </ChartCard>

      {riskTasks.length > 0 ? (
        <ChartCard title="Highest-risk tasks" subtitle="Task-level risk scores generated by the backend AI engine.">
          <div style={{ display: 'grid', gap: 10 }}>
            {riskTasks.slice(0, 5).map((task) => {
              const color = severityColor(task.severity)
              return (
                <div key={task.task_id || task.title} className="miniCard" style={{ borderLeft: `4px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={{ fontWeight: 900 }}>{task.title}</div>
                    <span className="pill pillMuted" style={{ color }}>{task.risk_score}%</span>
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>{task.reason}</div>
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800 }}>Suggestion: {task.suggestion}</div>
                </div>
              )
            })}
          </div>
        </ChartCard>
      ) : null}

      <div className="grid2">
        <ChartCard title="AI task suggestions" subtitle="Recommended execution moves based on risk, velocity, and performance.">
          <div style={{ display: 'grid', gap: 10 }}>
            {aiSuggestions.map((suggestion, index) => (
              <div key={suggestion} className="miniCard" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="pill pillMuted" style={{ color: '#8b5cf6' }}>AI {index + 1}</span>
                <div style={{ color: 'var(--text2)', lineHeight: 1.55, fontSize: 13 }}>{suggestion}</div>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Smart workload redistribution" subtitle="Suggested reassignment moves to reduce delivery risk.">
          <div style={{ display: 'grid', gap: 10 }}>
            {redistribution.length === 0 ? (
              <div style={{ color: 'var(--text2)' }}>No redistribution needed. Current workload balance is acceptable.</div>
            ) : redistribution.map((move) => (
              <div key={`${move.from}-${move.to}`} className="miniCard">
                <div style={{ fontWeight: 900 }}>{move.from} → {move.to}</div>
                <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>Move approximately {move.tasks} task{move.tasks === 1 ? '' : 's'}. {move.reason}</div>
              </div>
            ))}
          </div>
        </ChartCard>
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
        <div className="miniCard"><div className="miniLabel">AI confidence</div><div className="miniValue">{avgConfidenceAvailable ? `${Math.round(avgConfidence * 100)}%` : '—'}</div></div>
        <div className="miniCard"><div className="miniLabel">Avg workload</div><div className="miniValue">{workload.averageOpenTasks.toFixed(1)}</div></div>
      </div>

      <div className="grid2">
        <ChartCard title="Task status distribution" subtitle="Current task mix by lifecycle state."><StatusDonutChart byStatus={byStatus} /></ChartCard>
        <ChartCard title="Tasks by status" subtitle="Operational workload grouped by status."><StatusBarChart byStatus={byStatus} /></ChartCard>
      </div>
      <div className="grid2">
        <ChartCard title="Created / completed / overdue trend" subtitle={`Daily trend across the last ${days} days.`}><DeadlinesTrendChart points={trend.map((p) => ({ day: String(p.day).slice(5, 10), due: Number(p.created || 0), completed: Number(p.completed || 0), overdue: Number(p.overdue || 0) }))} /></ChartCard>
        <ChartCard title="Priority pressure" subtitle="Risk-weighted work pressure inferred from current task state."><PriorityPieChart byPriority={priorityPressure} /></ChartCard>
      </div>
      <div className="grid2">
        <ChartCard title="Workload balance" subtitle="Overloaded, balanced, and underutilized team members."><WorkloadBalanceChart userCount={workloadEmployees.length} workload={workload} /></ChartCard>
        <ChartCard title="Employee performance" subtitle="Completion and delivery score by employee."><AssigneeScoreChart rows={performanceRows} /></ChartCard>
      </div>
    </div>
  )
}
