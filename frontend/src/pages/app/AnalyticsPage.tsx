import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import {
  fetchAnalyticsAiConfidence,
  fetchAnalyticsAiValidation,
  fetchAnalyticsEmployeePerformance,
  fetchAnalyticsSummary,
  fetchAnalyticsTaskStatus,
  fetchAnalyticsTasksOverTime,
  fetchAnalyticsWorkload,
} from '../../lib/analytics'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'
import { Modal } from '../../components/Modal'
import {
  AssignmentsBreakdownTable,
  KpiStrip,
  PriorityBreakdown,
  StatusMiniChart,
  TaskSampleTable,
} from '../../components/insight/InsightBodies'
import { EmployeeDetailModal } from '../../components/employees/EmployeeDetailModal'
import type { TaskLite } from '../../components/insight/types'

type LeaderboardRow = {
  userId: string
  name: string
  department?: string | null
  role?: string | null
  total: number
  completed: number
  active: number
  overdue: number
  rejected: number
  completionRate: number
  onTimeRate: number
  performanceScore: number
}

function toNumber(value: string | number | undefined | null) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

async function fetchTasksForDrilldown() {
  const qs = new URLSearchParams({ limit: '300', page: '1' })
  const data = await apiFetch<{ tasks?: TaskLite[]; rows?: TaskLite[] }>(`/api/v1/tasks?${qs.toString()}`)
  return (data.tasks || data.rows || []) as TaskLite[]
}

export function AnalyticsPage() {
  const navigate = useNavigate()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart' }>(null)
  const [pickId, setPickId] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(30)

  const summaryQ = useQuery({ queryKey: ['analytics-v2', 'summary', rangeDays], queryFn: () => fetchAnalyticsSummary(rangeDays) })
  const statusQ = useQuery({ queryKey: ['analytics-v2', 'task-status', rangeDays], queryFn: () => fetchAnalyticsTaskStatus(rangeDays) })
  const trendQ = useQuery({ queryKey: ['analytics-v2', 'tasks-over-time', rangeDays], queryFn: () => fetchAnalyticsTasksOverTime(rangeDays) })
  const performanceQ = useQuery({ queryKey: ['analytics-v2', 'employee-performance', rangeDays], queryFn: () => fetchAnalyticsEmployeePerformance(rangeDays) })
  const workloadQ = useQuery({ queryKey: ['analytics-v2', 'workload', rangeDays], queryFn: () => fetchAnalyticsWorkload(rangeDays) })
  const aiValidationQ = useQuery({ queryKey: ['analytics-v2', 'ai-validation', rangeDays], queryFn: () => fetchAnalyticsAiValidation(rangeDays) })
  const aiConfidenceQ = useQuery({ queryKey: ['analytics-v2', 'ai-confidence', rangeDays], queryFn: () => fetchAnalyticsAiConfidence(rangeDays) })
  const tasksQ = useQuery({ queryKey: ['analytics-v2', 'tasks-drilldown'], queryFn: fetchTasksForDrilldown })

  const byStatus = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of statusQ.data?.statuses || []) out[item.status] = item.count
    if (!Object.keys(out).length && summaryQ.data) {
      out.completed = summaryQ.data.completed_tasks || 0
      out.pending = summaryQ.data.pending_tasks || 0
      out.overdue = summaryQ.data.overdue_tasks || 0
    }
    return out
  }, [statusQ.data, summaryQ.data])

  const total = summaryQ.data?.total_tasks || 0
  const done = summaryQ.data?.completed_tasks || byStatus.completed || 0
  const overdue = summaryQ.data?.overdue_tasks || byStatus.overdue || 0
  const pending = summaryQ.data?.pending_tasks || byStatus.pending || 0
  const inProgress = byStatus.in_progress || 0
  const activeEmployees = summaryQ.data?.active_employees || 0
  const avgCompletionHours = toNumber(summaryQ.data?.avg_completion_hours)
  const avgCompletionDays = avgCompletionHours ? Number((avgCompletionHours / 24).toFixed(1)) : 0
  const aiConfidence = toNumber(aiConfidenceQ.data?.average ?? summaryQ.data?.avg_ai_confidence)
  const completionRate = total ? Math.round((done / total) * 100) : 0
  const aiApproved = aiValidationQ.data?.statuses.find((s) => ['accepted', 'approved', 'manager_approved'].includes(String(s.status).toLowerCase()))?.count || 0
  const aiApprovalRate = total ? Math.round((aiApproved / total) * 100) : 0
  const score = Math.round((completionRate * 0.65) + (Math.min(100, aiConfidence * 100) * 0.35))

  const leaderboard: LeaderboardRow[] = useMemo(() => {
    return (performanceQ.data?.employees || []).map((row) => {
      const totalTasks = row.assigned || 0
      const completed = row.completed || 0
      const active = Math.max(0, totalTasks - completed)
      const rate = totalTasks ? Math.round((completed / totalTasks) * 100) : 0
      return {
        userId: row.employee_id,
        name: row.employee_name || 'Unknown employee',
        total: totalTasks,
        completed,
        active,
        overdue: row.overdue || 0,
        rejected: 0,
        completionRate: rate,
        onTimeRate: row.overdue ? Math.max(0, 100 - Math.round((row.overdue / Math.max(1, totalTasks)) * 100)) : 100,
        performanceScore: Math.max(0, Math.min(100, rate - Math.min(30, (row.overdue || 0) * 5))),
      }
    })
  }, [performanceQ.data])

  const workload = useMemo(() => {
    const employees = workloadQ.data?.employees || []
    const avg = employees.length ? employees.reduce((sum, row) => sum + (row.open_tasks || 0), 0) / employees.length : 0
    const overloaded = employees
      .filter((row) => row.open_tasks > Math.max(5, avg * 1.5))
      .map((row) => ({ userId: row.employee_id, name: row.employee_name, active: row.open_tasks, performanceScore: 0 }))
    const underutilized = employees
      .filter((row) => row.open_tasks <= Math.max(1, avg * 0.35))
      .map((row) => ({ userId: row.employee_id, name: row.employee_name, active: row.open_tasks, performanceScore: 0 }))
    return { averageOpenTasks: avg, overloaded, underutilized }
  }, [workloadQ.data])

  const deadlinePoints = useMemo(() => {
    return (trendQ.data?.points || []).map((point) => ({
      day: String(point.day).slice(5, 10),
      due: point.created || 0,
      overdue: point.overdue || 0,
    }))
  }, [trendQ.data])

  const tasks = tasksQ.data || []

  const byPriority = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) {
      const p = String(t.priority || '').toLowerCase()
      if (!p) continue
      out[p] = (out[p] || 0) + 1
    }
    return out
  }, [tasks])

  const assignmentRows = useMemo(() => leaderboard.map((u) => ({ name: u.name, active: u.active, overdue: u.overdue, done: u.completed })), [leaderboard])

  const capacityIndex = useMemo(() => {
    const totalUsers = activeEmployees || workloadQ.data?.employees.length || 0
    if (!totalUsers) return 0
    return Math.round(Math.max(0, totalUsers - workload.overloaded.length - workload.underutilized.length) / totalUsers * 100)
  }, [activeEmployees, workload, workloadQ.data])

  function downloadCsv() {
    const rows = [
      ['Metric', 'Value'],
      ['Total tasks', String(total)],
      ['Completed tasks', String(done)],
      ['Pending tasks', String(pending)],
      ['Overdue tasks', String(overdue)],
      ['Active employees', String(activeEmployees)],
      ['Completion rate', `${completionRate}%`],
      ['Average completion days', String(avgCompletionDays || 0)],
      ['AI confidence', String(aiConfidence)],
    ]
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-summary-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasError = summaryQ.isError || statusQ.isError || trendQ.isError || performanceQ.isError || workloadQ.isError

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Analytics Intelligence
            </div>
            <div className="pageHeaderCardSub">Operational performance, workload balance, AI validation, and completion trends powered by the new analytics API.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📊</span> Live backend analytics</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📈</span> Executive KPIs</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🤖</span> AI quality signals</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
            </select>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={downloadCsv}>Download CSV</button>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={() => window.print()}>Download PDF</button>
          </div>
        </div>
      </div>
      {hasError ? <div className="alertV4 alertV4Error">Some analytics panels failed to load.</div> : null}

      <div className="grid4">
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Total tasks', kind: 'kpi' })}><div className="miniLabel">Total tasks</div><div className="miniValue">{total}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Completed tasks', kind: 'kpi' })}><div className="miniLabel">Completed</div><div className="miniValue">{done}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Pending tasks', kind: 'kpi' })}><div className="miniLabel">Pending</div><div className="miniValue">{pending}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Overdue', kind: 'kpi' })}><div className="miniLabel">Overdue</div><div className="miniValue" style={{ color: 'rgba(239, 68, 68, 0.92)' }}>{overdue}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Completion rate', kind: 'kpi' })}><div className="miniLabel">Completion rate</div><div className="miniValue">{completionRate}%</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'AI approval rate', kind: 'kpi' })}><div className="miniLabel">AI approval rate</div><div className="miniValue">{aiApprovalRate}%</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Active employees', kind: 'kpi' })}><div className="miniLabel">Active employees</div><div className="miniValue">{activeEmployees}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Average completion time', kind: 'kpi' })}><div className="miniLabel">Avg completion time</div><div className="miniValue">{avgCompletionDays ? `${avgCompletionDays}d` : '—'}</div></button>
      </div>

      <ChartCard title="Executive health" subtitle="Combined completion, capacity, and AI quality score.">
        <div className="grid4">
          <div className="miniCard"><div className="miniLabel">Health score</div><div className="miniValue">{score}</div></div>
          <div className="miniCard"><div className="miniLabel">Capacity index</div><div className="miniValue">{capacityIndex}%</div></div>
          <div className="miniCard"><div className="miniLabel">AI confidence</div><div className="miniValue">{Math.round(aiConfidence * 100)}%</div></div>
          <div className="miniCard"><div className="miniLabel">Avg open tasks</div><div className="miniValue">{workload.averageOpenTasks.toFixed(1)}</div></div>
        </div>
      </ChartCard>

      <div className="grid2">
        <ChartCard title="Task status distribution" subtitle="Live status distribution from /api/v1/analytics/task-status." right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Tasks by status', kind: 'chart' })}>Details</button>}>
          <StatusBarChart byStatus={byStatus} />
        </ChartCard>
        <ChartCard title="Tasks over time" subtitle={`Created, completed, and overdue trend over ${rangeDays} days.`} right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Tasks over time', kind: 'chart' })}>Details</button>}>
          <DeadlinesTrendChart points={deadlinePoints} />
        </ChartCard>
      </div>

      <div className="grid2">
        <ChartCard title="Workload balance" subtitle="Overloaded, balanced, and underutilized employees." right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Workload balance', kind: 'chart' })}>Details</button>}>
          <WorkloadBalanceChart fillHeight userCount={activeEmployees || workloadQ.data?.employees.length || 0} workload={workload} />
        </ChartCard>
        <ChartCard title="Priority mix" subtitle="Priority distribution from current task sample." right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Priority mix', kind: 'chart' })}>Details</button>}>
          <PriorityPieChart byPriority={byPriority} />
        </ChartCard>
      </div>

      <ChartCard title="Employee performance" subtitle="Assigned vs completed vs overdue, ranked by delivery score." right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Team performance', kind: 'chart' })}>Details</button>}>
        {performanceQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!performanceQ.isLoading && leaderboard.length === 0 ? <div style={{ color: 'var(--text2)' }}>No team data yet.</div> : null}
        <AssigneeScoreChart rows={leaderboard.map((u) => ({ name: u.name, active: u.active, completed: u.completed, performanceScore: u.performanceScore }))} />
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {leaderboard.slice(0, 8).map((u) => (
            <button key={u.userId} type="button" className="miniCard miniLink" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left' }} onClick={() => setPickId(u.userId)}>
              <span style={{ fontWeight: 850 }}>{u.name}</span>
              <span className="pill pillMuted">Score {u.performanceScore}</span>
            </button>
          ))}
        </div>
      </ChartCard>

      <Modal title={detail?.title || 'Details'} open={!!detail} wide={detail?.kind === 'chart'} onClose={() => setDetail(null)} footer={<div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}><button type="button" className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} onClick={() => { setDetail(null); navigate('/app/tasks') }}>Open tasks</button></div>}>
        {detail?.kind === 'kpi' ? <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} /> : null}
        {detail?.kind === 'chart' && detail.title === 'Tasks by status' ? <><StatusMiniChart byStatus={byStatus} /><TaskSampleTable tasks={tasks} empty="No tasks." /></> : null}
        {detail?.kind === 'chart' && detail.title === 'Tasks over time' ? <><PriorityBreakdown byPriority={byPriority} /><TaskSampleTable tasks={tasks} empty="No tasks." /></> : null}
        {detail?.kind === 'chart' && detail.title === 'Team performance' ? <><AssignmentsBreakdownTable rows={assignmentRows} /><TaskSampleTable tasks={tasks} empty="No tasks." /></> : null}
        {detail?.kind === 'chart' && detail.title === 'Workload balance' ? <><div style={{ color: 'var(--text2)', marginBottom: 12 }}>Overloaded: {workload.overloaded.length}. Underutilized: {workload.underutilized.length}.</div><TaskSampleTable tasks={tasks} empty="No tasks loaded." /></> : null}
      </Modal>
      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
