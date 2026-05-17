import { useMemo, useState, useCallback } from 'react'
import { IconSpark } from '../../components/ui/AppIcons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useRealtimeInvalidation } from '../../lib/socket'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, StatusDonutChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'

type AIStatus = { active_model: string; groq: boolean; anthropic: boolean }

type Insight = { id: string; title: string; description: string; severity: 'low' | 'medium' | 'high' | 'critical'; recommendation: string }
type InsightsResponse = { generated_at: string; insights: Insight[] }
type AnalyticsSummary = { total_tasks: number; completed_tasks: number; pending_tasks: number; overdue_tasks: number; active_employees: number; avg_completion_hours: string | number; avg_ai_confidence: string | number }
type StatusPoint = { status: string; count: number }
type TrendPoint = { day: string; created?: number; completed?: number; overdue?: number }
type EmployeePerformance = { employee_id: string; employee_name: string; assigned: number; completed: number; overdue: number }
type WorkloadEmployee = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }
type RiskSignal = { title: string; detail: string; score: number; severity: Insight['severity']; action: string }
type Redistribution = { from: string; to: string; tasks: number; reason: string }
type AIInsight = { title: string; description: string; severity: Insight['severity']; recommendation: string; evidence?: string }
type BackendAiOverview = {
  generated_at: string
  ai_model?: string           // 'groq-llama3' | 'claude-sonnet' | 'rule-based'
  ai_generated_at?: string
  predictive_risks: RiskSignal[]
  risk_tasks: Array<{ task_id: string; title: string; risk_score: number; severity: Insight['severity']; reason: string; suggestion: string; assigned_to_name?: string; due_date?: string; priority?: string; status?: string }>
  suggestions: string[]
  ai_suggestions?: string[]
  ai_insights?: AIInsight[]
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
function timeAgoShort(iso?: string) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function AIModelBadge({ model }: { model?: string }) {
  if (!model) return null
  const isGroq = model === 'groq-llama3'
  const isClaude = model === 'claude-sonnet'
  const label = isGroq ? '⚡ Llama 3.3 70B' : isClaude ? '✦ Claude Sonnet' : '⚙ Rule-based'
  const color = isGroq ? '#06b6d4' : isClaude ? '#a78bfa' : '#94a3b8'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 8,
      background: `${color}16`, border: `1px solid ${color}35`,
      color, fontSize: 11, fontWeight: 800,
    }}>
      {label}
    </span>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [aiRefreshing, setAiRefreshing] = useState(false)
  const qc = useQueryClient()

  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })

  // AI status from backend — always fresh, refetches every 30s
  // This drives the badge: as soon as GROQ_API_KEY is set in Railway and redeploy completes,
  // this query returns { active_model: 'groq-llama3' } and the badge updates automatically.
  const aiStatusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiFetch<AIStatus>('/api/v1/ai/status'),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const insightsQ   = useQuery({ queryKey: ['insights', days],           queryFn: () => fetchInsights(days), staleTime: 60_000, refetchInterval: 60_000 })
  const summaryQ    = useQuery({ queryKey: ['analytics-summary', days],  queryFn: () => fetchSummary(days),  staleTime: 30_000, refetchInterval: 30_000 })
  const statusQ     = useQuery({ queryKey: ['analytics-status', days],   queryFn: () => fetchStatus(days),   staleTime: 30_000, refetchInterval: 30_000 })
  const trendQ      = useQuery({ queryKey: ['analytics-trend', days],    queryFn: () => fetchTrend(days),    staleTime: 60_000, refetchInterval: 60_000 })
  const employeesQ  = useQuery({ queryKey: ['analytics-employees', days],queryFn: () => fetchEmployees(days),staleTime: 60_000, refetchInterval: 60_000 })
  const workloadQ   = useQuery({ queryKey: ['analytics-workload', days], queryFn: () => fetchWorkload(days), staleTime: 30_000, refetchInterval: 30_000 })
  // AI overview: refetch every 5 min automatically (LLM analysis is expensive — don't spam)
  const backendAiQ  = useQuery({
    queryKey: ['backend-ai-overview', days],
    queryFn: () => fetchBackendAi(days),
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  // Manual refresh of AI analysis only
  const refreshAI = useCallback(async () => {
    setAiRefreshing(true)
    await qc.invalidateQueries({ queryKey: ['backend-ai-overview', days] })
    setAiRefreshing(false)
  }, [qc, days])

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

  const priorityPressure = { high: overdue, medium: Math.max(0, pending - overdue), low: Math.max(0, total - pending - completed) }

  // Rule-based fallbacks (used only when AI call fails)
  const fallbackPredictiveRisks = useMemo<RiskSignal[]>(() => {
    const latest = trend.slice(-7)
    const recentCreated = latest.reduce((s, p) => s + Number(p.created || 0), 0)
    const recentCompleted = latest.reduce((s, p) => s + Number(p.completed || 0), 0)
    const backlogVelocityGap = Math.max(0, recentCreated - recentCompleted)
    const deliveryPressure = Math.min(100, Math.round(overdueRate * 1.2 + backlogVelocityGap * 8 + Math.max(0, 75 - completionRate) * 0.7))
    const workloadPressure = Math.min(100, Math.round((workload.overloaded.length * 22) + Math.max(0, workload.averageOpenTasks - 4) * 8))
    const aiConfidenceRisk = avgConfidenceAvailable ? Math.min(100, Math.round(Math.max(0, 0.78 - avgConfidence) * 130)) : 0
    return [
      { title: 'Deadline risk', detail: `${overdue} overdue, ${pending} open, ${backlogVelocityGap} net new in 7d.`, score: deliveryPressure, severity: riskSeverity(deliveryPressure), action: deliveryPressure >= 65 ? 'Freeze low-priority intake and focus on overdue tasks.' : 'Maintain cadence and monitor daily.' },
      { title: 'Capacity risk', detail: `${workload.overloaded.length} overloaded, ${workload.underutilized.length} underutilized, avg ${workload.averageOpenTasks.toFixed(1)} open/person.`, score: workloadPressure, severity: riskSeverity(workloadPressure), action: workloadPressure >= 65 ? 'Rebalance before assigning new work.' : 'Capacity acceptable — keep visible.' },
      { title: 'AI confidence risk', detail: avgConfidenceAvailable ? `Avg AI confidence ${Math.round(avgConfidence * 100)}%.` : 'No AI confidence data yet.', score: aiConfidenceRisk, severity: avgConfidenceAvailable ? riskSeverity(aiConfidenceRisk) : 'low', action: aiConfidenceRisk >= 40 ? 'Route low-confidence decisions to manager review.' : 'No alarm — continue monitoring.' },
    ]
  }, [avgConfidence, avgConfidenceAvailable, completionRate, overdue, overdueRate, pending, trend, workload])

  const fallbackSuggestions = useMemo(() => {
    const strongest = performanceRows.slice().sort((a, b) => b.performanceScore - a.performanceScore)[0]
    const low = performanceRows.filter((r) => r.performanceScore < 60 && (r.active || r.completed)).slice(0, 3)
    return [
      overdue > 0 ? `Escalate ${overdue} overdue task${overdue === 1 ? '' : 's'} — require owner updates before EOD.` : 'No overdue escalation needed.',
      workload.overloaded.length > 0 ? `Reassign 1-2 tasks from ${workload.overloaded.length} overloaded person${workload.overloaded.length > 1 ? 's' : ''} before adding new work.` : 'Workload is balanced.',
      strongest ? `${strongest.name} leads at ${strongest.performanceScore}% delivery score — consider as template owner for high-priority tasks.` : 'Assign owners consistently to build performance data.',
      low.length > 0 ? `Coach ${low.map((p) => p.name).join(', ')} with smaller task batches and clearer due dates.` : 'No delivery-score coaching signals.',
    ]
  }, [overdue, performanceRows, workload.overloaded.length])

  const fallbackRedistribution = useMemo<Redistribution[]>(() => {
    const overloadedSorted = workloadEmployees.slice().sort((a, b) => Number(b.open_tasks || 0) - Number(a.open_tasks || 0)).filter((e) => Number(e.open_tasks || 0) > Math.max(5, workload.averageOpenTasks * 1.5))
    const underSorted = workloadEmployees.slice().sort((a, b) => Number(a.open_tasks || 0) - Number(b.open_tasks || 0)).filter((e) => Number(e.open_tasks || 0) <= Math.max(1, workload.averageOpenTasks * 0.35))
    return overloadedSorted.slice(0, 3).map((from, i) => {
      const to = underSorted[i % Math.max(underSorted.length, 1)]
      return { from: from.employee_name || 'Overloaded owner', to: to?.employee_name || 'next available', tasks: Math.max(1, Math.min(3, Math.round((Number(from.open_tasks || 0) - workload.averageOpenTasks) / 2))), reason: `${from.employee_name} has ${from.open_tasks} open vs ${workload.averageOpenTasks.toFixed(1)} avg.` }
    })
  }, [workload.averageOpenTasks, workloadEmployees])

  const backendAi = backendAiQ.data
  // Use /ai/status as the authoritative badge source — it reflects env vars directly.
  // Fall back to what the predictive-overview response says if status hasn't loaded yet.
  const aiModel = aiStatusQ.data?.active_model || backendAi?.ai_model
  const isRealAI = aiModel === 'groq-llama3' || aiModel === 'claude-sonnet'

  // Use AI-generated content when available, fall back to rule-based
  const predictiveRisks = backendAi?.predictive_risks?.length ? backendAi.predictive_risks : fallbackPredictiveRisks
  const aiSuggestions   = (backendAi?.ai_suggestions?.length ? backendAi.ai_suggestions : backendAi?.suggestions?.length ? backendAi.suggestions : fallbackSuggestions)
  const aiInsightsCards = backendAi?.ai_insights || []
  const redistribution  = backendAi?.workload_redistribution?.length ? backendAi.workload_redistribution : fallbackRedistribution
  const riskTasks       = backendAi?.risk_tasks || []
  const aiTimestamp     = backendAi?.ai_generated_at || backendAi?.generated_at

  const kpis = [
    { label: 'Total tasks',      value: summaryQ.isLoading ? '—' : total,              tone: undefined },
    { label: 'Completion rate',  value: `${completionRate}%`,                           tone: '#22c55e' },
    { label: 'Pending',          value: pending,                                         tone: undefined },
    { label: 'Overdue',          value: overdue,                                         tone: overdue > 0 ? 'rgba(239,68,68,.92)' : undefined },
    { label: 'Active employees', value: summary?.active_employees ?? 0,                 tone: undefined },
    { label: 'Avg completion',   value: avgHours ? `${avgHours.toFixed(1)}h` : '—',     tone: undefined },
    { label: 'AI confidence',    value: avgConfidenceAvailable ? `${Math.round(avgConfidence * 100)}%` : '—', tone: undefined },
    { label: 'Avg workload',     value: workload.averageOpenTasks.toFixed(1),            tone: undefined },
  ]

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Header */}
      <PageHeaderCard
        title="Analytics Intelligence"
        subtitle="Live charts · AI-powered risk analysis · Real-time recommendations"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 4, border: '1px solid var(--border)' }}>
              {[7, 30, 90].map(d => (
                <button key={d} type="button" onClick={() => setDays(d)} style={{ padding: '6px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 750, fontSize: 12, transition: 'all 0.15s', background: days === d ? 'var(--primary)' : 'transparent', color: days === d ? '#000' : 'var(--text2)' }}>
                  {d === 7 ? '7d' : d === 30 ? '30d' : '90d'}
                </button>
              ))}
            </div>
            <button type="button" onClick={refreshAI} disabled={aiRefreshing || backendAiQ.isFetching}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.06)', color: 'var(--text2)', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: (aiRefreshing || backendAiQ.isFetching) ? 0.6 : 1 }}>
              {(aiRefreshing || backendAiQ.isFetching)
                ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Analyzing…</>
                : <>⟳ Refresh AI</>}
            </button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="analyticsSignalStrip">
        {summaryQ.isLoading
          ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="miniCard skeleton" style={{ height: 68 }} />)
          : kpis.map((item) => (
              <div key={item.label} className="miniCard">
                <div className="miniLabel">{item.label}</div>
                <div className="miniValue" style={item.tone ? { color: item.tone } : undefined}>{item.value}</div>
              </div>
            ))
        }
      </div>

      {/* Charts grid */}
      <div style={{ display: 'grid', gap: 16 }}>
        <ChartCard title="Created / Completed / Overdue Trend" subtitle={`Velocity over the last ${days} days`} loading={trendQ.isLoading}>
          <DeadlinesTrendChart fillHeight points={trend.map((p) => ({ day: String(p.day).slice(5, 10), due: Number(p.created || 0), completed: Number(p.completed || 0), overdue: Number(p.overdue || 0) }))} loading={trendQ.isLoading} />
        </ChartCard>
        <div className="analyticsChartGrid">
          <ChartCard title="Task Status Distribution" subtitle="Current task mix by lifecycle state" loading={statusQ.isLoading}>
            <StatusDonutChart byStatus={byStatus} loading={statusQ.isLoading} />
          </ChartCard>
          <ChartCard title="Tasks by Status" subtitle="Operational workload grouped by status" loading={statusQ.isLoading}>
            <StatusBarChart byStatus={byStatus} loading={statusQ.isLoading} />
          </ChartCard>
        </div>
        <div className="analyticsChartGrid">
          <ChartCard title="Priority Pressure" subtitle="Risk-weighted work pressure" loading={summaryQ.isLoading}>
            <PriorityPieChart byPriority={priorityPressure} loading={summaryQ.isLoading} />
          </ChartCard>
          <ChartCard title="Workload Balance" subtitle="Overloaded vs underutilized members" loading={workloadQ.isLoading}>
            <WorkloadBalanceChart userCount={workloadEmployees.length} workload={workload} loading={workloadQ.isLoading} />
          </ChartCard>
        </div>
        <ChartCard title="Employee Performance" subtitle="Completion and delivery score by employee" loading={employeesQ.isLoading}>
          <AssigneeScoreChart fillHeight rows={performanceRows} loading={employeesQ.isLoading} />
        </ChartCard>
      </div>

      {/* AI Intelligence header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 4px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)' }}>🤖 AI Intelligence</div>
        <AIModelBadge model={aiModel} />
        {aiTimestamp && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            Last analyzed {timeAgoShort(aiTimestamp)}
          </span>
        )}
        {!backendAiQ.isFetching && !isRealAI && (
          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
            ⚠ Set GROQ_API_KEY in Railway for real AI analysis
          </span>
        )}
        {backendAiQ.isFetching && (
          <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, animation: 'pulse 1.5s ease-in-out infinite' }}>
            Analyzing your live data…
          </span>
        )}
      </div>

      {/* Predictive risk cards */}
      <ChartCard
        title="Predictive Risk Intelligence"
        subtitle={isRealAI ? `AI-generated risk analysis from live task signals` : 'Rule-based risk scoring from live task signals'}
        loading={backendAiQ.isLoading}
      >
        {backendAiQ.isError && <div className="alertV4 alertV4Error" style={{ marginBottom: 12 }}>AI service unavailable — showing rule-based predictions.</div>}
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
                  <div style={{ height: '100%', width: `${risk.score}%`, background: color, borderRadius: 999, transition: 'width 0.8s ease' }} />
                </div>
                <div style={{ marginTop: 10, color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>{risk.detail}</div>
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800 }}>→ {risk.action}</div>
              </div>
            )
          })}
        </div>
      </ChartCard>

      {/* AI-generated insight cards — only shown when real AI responds */}
      {aiInsightsCards.length > 0 && (
        <ChartCard title="AI Insight Cards" subtitle={`${aiInsightsCards.length} insights generated by ${aiModel === 'groq-llama3' ? 'Llama 3.3 70B' : 'Claude Sonnet'}`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {aiInsightsCards.map((ins, i) => {
              const color = severityColor(ins.severity)
              return (
                <div key={i} className="miniCard" style={{ borderLeft: `4px solid ${color}`, background: `${color}10` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontWeight: 900 }}>{ins.title}</div>
                    <span className="pill pillMuted" style={{ color }}>{ins.severity.toUpperCase()}</span>
                  </div>
                  <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>{ins.description}</div>
                  {ins.evidence && <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 6 }}>Evidence: {ins.evidence}</div>}
                  <div style={{ fontSize: 13, fontWeight: 800 }}>→ {ins.recommendation}</div>
                </div>
              )
            })}
          </div>
        </ChartCard>
      )}

      {/* Risk tasks */}
      {riskTasks.length > 0 && (
        <ChartCard title="Highest-Risk Tasks" subtitle="Task-level risk scores from live signal analysis">
          <div style={{ display: 'grid', gap: 10 }}>
            {riskTasks.slice(0, 5).map((task) => {
              const color = severityColor(task.severity)
              return (
                <div key={task.task_id || task.title} className="miniCard" style={{ borderLeft: `4px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={{ fontWeight: 900 }}>{task.title}</div>
                    <span className="pill pillMuted" style={{ color }}>{task.risk_score}%</span>
                  </div>
                  {task.assigned_to_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Assigned: {task.assigned_to_name}</div>}
                  <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>{task.reason}</div>
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800 }}>→ {task.suggestion}</div>
                </div>
              )
            })}
          </div>
        </ChartCard>
      )}

      <div className="grid2">
        {/* AI suggestions */}
        <ChartCard
          title={isRealAI ? 'AI-Generated Action Plan' : 'Suggested Actions'}
          subtitle={isRealAI ? `Specific moves recommended by ${aiModel === 'groq-llama3' ? 'Llama 3.3 70B' : 'Claude Sonnet'} from your live data` : 'Rule-based recommendations from live analytics'}
          loading={backendAiQ.isLoading}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            {aiSuggestions.map((suggestion, index) => (
              <div key={suggestion} className="miniCard" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: `3px solid ${isRealAI ? '#8b5cf6' : 'var(--border)'}` }}>
                <span className="pill pillMuted" style={{ color: isRealAI ? '#8b5cf6' : 'var(--muted)', flexShrink: 0 }}>
                  {isRealAI ? <IconSpark size={14} /> : '→'} {index + 1}
                </span>
                <div style={{ color: 'var(--text2)', lineHeight: 1.6, fontSize: 13 }}>{suggestion}</div>
              </div>
            ))}
          </div>
        </ChartCard>

        {/* Workload redistribution */}
        <ChartCard title="Workload Redistribution" subtitle="Suggested reassignment moves to reduce delivery risk">
          <div style={{ display: 'grid', gap: 10 }}>
            {redistribution.length === 0
              ? <div style={{ color: 'var(--text2)', fontSize: 13 }}>✅ No redistribution needed — workload is balanced.</div>
              : redistribution.map((move) => (
                  <div key={`${move.from}-${move.to}`} className="miniCard">
                    <div style={{ fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#ef4444' }}>{move.from}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 18 }}>→</span>
                      <span style={{ color: '#22c55e' }}>{move.to}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                      Move ~{move.tasks} task{move.tasks === 1 ? '' : 's'}. {move.reason}
                    </div>
                  </div>
                ))
            }
          </div>
        </ChartCard>
      </div>

      {/* Insights engine output */}
      <ChartCard title="Insights Engine" subtitle="Prioritized signals from the local analytics engine">
        {insightsQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Analyzing…</div> : null}
        {insightsQ.isError ? <div className="alertV4 alertV4Error">Failed to load insights.</div> : null}
        {!insightsQ.isLoading && !insightsQ.isError && !(insightsQ.data?.insights.length) ? <div style={{ color: 'var(--text2)' }}>No major risks detected.</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {(insightsQ.data?.insights || []).slice(0, 6).map((insight) => {
            const color = severityColor(insight.severity)
            return (
              <div key={insight.id} className="miniCard" style={{ borderLeft: `4px solid ${color}`, background: `${color}10` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900 }}>{insight.title}</div>
                  <span className="pill pillMuted" style={{ color }}>{insight.severity.toUpperCase()}</span>
                </div>
                <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>{insight.description}</div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 750 }}>→ {insight.recommendation}</div>
              </div>
            )
          })}
        </div>
      </ChartCard>
    </div>
  )
}
