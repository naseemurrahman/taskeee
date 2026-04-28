import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canViewAnalytics } from '../../lib/rbac'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, StatusDonutChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'
import { buildDeadlineSeries } from '../../components/charts/chartUtils'
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

type PerformanceUser = {
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
  activityCount14d?: number
}

type PerformanceSummary = {
  scope: 'organization' | 'team'
  totalTasks: number
  byStatus: Record<string, number>
  userCount: number
  teamPerformanceScore: number
  assigneeLeaderboard: PerformanceUser[]
  workload: {
    averageOpenTasks: number
    overloaded: Array<{ userId: string; name: string; active: number; performanceScore: number }>
    underutilized: Array<{ userId: string; name: string; active: number; performanceScore: number }>
  }
}

async function fetchSummary(rangeDays: number, department: string) {
  const qs = new URLSearchParams({ days: String(rangeDays) })
  if (department && department !== 'all') qs.set('department', department)
  return await apiFetch<PerformanceSummary>(`/api/v1/performance/summary?${qs.toString()}`)
}

async function fetchTasksForDeadlines() {
  const qs = new URLSearchParams({ limit: '300', page: '1' })
  const data = await apiFetch<{ tasks?: TaskLite[]; rows?: TaskLite[] }>(`/api/v1/tasks?${qs.toString()}`)
  return (data.tasks || data.rows || []) as TaskLite[]
}

function buildCompletedSeriesLocal(tasks: TaskLite[], days: number) {
  const labels = Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return d.toISOString().slice(5, 10)
  })
  const map = new Map(labels.map((label) => [label, 0]))
  for (const task of tasks) {
    if (!['completed', 'manager_approved'].includes(String(task.status))) continue
    const rawDate = String((task as TaskLite & { completed_at?: string; completedAt?: string }).completed_at || (task as TaskLite & { completedAt?: string }).completedAt || '')
    if (!rawDate) continue
    const key = rawDate.slice(5, 10)
    if (map.has(key)) map.set(key, (map.get(key) || 0) + 1)
  }
  return labels.map((day) => ({ day, completed: map.get(day) || 0 }))
}

export function AnalyticsPage() {
  const me = getUser()
  const canOpenChartDetails = canCreateTasksAndProjects(me?.role)
  const canOpenAdvancedDetails = canViewAnalytics(me?.role)
  const navigate = useNavigate()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart' }>(null)
  const [pickId, setPickId] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(30)
  const department = 'all'
  const summaryQ = useQuery({ queryKey: ['analytics', 'summary', rangeDays, department], queryFn: () => fetchSummary(rangeDays, department) })
  const tasksQ = useQuery({ queryKey: ['analytics', 'deadlines'], queryFn: fetchTasksForDeadlines })

  const byStatus = summaryQ.data?.byStatus || {}
  const total = summaryQ.data?.totalTasks || 0
  const done = byStatus.completed || 0
  const overdue = byStatus.overdue || 0
  const inProgress = byStatus.in_progress || 0
  const completionRate = total ? Math.round((done / total) * 100) : 0
  const score = summaryQ.data?.teamPerformanceScore ?? 0

  const leaderboard = useMemo(() => summaryQ.data?.assigneeLeaderboard || [], [summaryQ.data])
  const deadlinePoints = useMemo(() => buildDeadlineSeries(tasksQ.data || [], 14), [tasksQ.data])
  const completedPoints = useMemo(() => buildCompletedSeriesLocal(tasksQ.data || [], 14), [tasksQ.data])
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

  const assignmentRows = useMemo(() => leaderboard.map((u: PerformanceUser) => ({ name: u.name, active: u.active, overdue: u.overdue, done: u.completed })), [leaderboard])

  const pending = byStatus.pending || 0
  const activeEmployees = leaderboard.length
  const aiApprovalRate = total ? Math.round(((done + (byStatus.manager_approved || 0)) / total) * 100) : 0
  const avgCompletionDays = useMemo(() => {
    const avgDailyCompletion = (completedPoints.reduce((sum: number, point: { completed: number }) => sum + point.completed, 0) / Math.max(1, completedPoints.length)) || 0
    if (!avgDailyCompletion) return 0
    return Number((Math.max(0, total - done) / avgDailyCompletion).toFixed(1))
  }, [completedPoints, total, done])

  const capacityIndex = useMemo(() => {
    const overloaded = summaryQ.data?.workload?.overloaded.length ?? 0
    const underutilized = summaryQ.data?.workload?.underutilized.length ?? 0
    const totalUsers = summaryQ.data?.userCount ?? 0
    if (!totalUsers) return 0
    return Math.round(Math.max(0, totalUsers - overloaded - underutilized) / totalUsers * 100)
  }, [summaryQ.data?.workload, summaryQ.data?.userCount])

  const departmentBreakdown = useMemo(() => {
    const map = new Map<string, { department: string; members: number; completed: number; overdue: number; active: number }>()
    for (const row of leaderboard) {
      const key = row.department || 'Unassigned'
      const curr = map.get(key) || { department: key, members: 0, completed: 0, overdue: 0, active: 0 }
      curr.members += 1
      curr.completed += row.completed || 0
      curr.overdue += row.overdue || 0
      curr.active += row.active || 0
      map.set(key, curr)
    }
    return Array.from(map.values()).sort((a, b) => b.completed - a.completed)
  }, [leaderboard])

  function openDetail(title: string, kind: 'kpi' | 'chart') {
    if (!canOpenChartDetails && kind === 'chart') {
      setDetail({ title: 'Details limited', kind: 'chart' })
      return
    }
    setDetail({ title, kind })
  }

  function downloadCsv() {
    const rows = [
      ['Department', 'Members', 'Completed', 'Overdue', 'Active'],
      ...departmentBreakdown.map(d => [d.department, String(d.members), String(d.completed), String(d.overdue), String(d.active)]),
    ]
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-departments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Analytics</div>
            <div className="pageHeaderCardSub">Deep-dive into task completion rates, team performance, deadline trends, and workload balance across your organization.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={downloadCsv}>Download CSV</button>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={() => window.print()}>Download PDF</button>
          </div>
        </div>
      </div>
      {summaryQ.isError ? <div className="alertV4 alertV4Error">Failed to load summary.</div> : null}

      <div className="grid4">
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Total tasks', kind: 'kpi' })}><div className="miniLabel">Total tasks</div><div className="miniValue">{total}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Completion rate', kind: 'kpi' })}><div className="miniLabel">Completion rate</div><div className="miniValue">{completionRate}%</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Overdue', kind: 'kpi' })}><div className="miniLabel">Overdue</div><div className="miniValue" style={{ color: 'rgba(239, 68, 68, 0.92)' }}>{overdue}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Team score', kind: 'kpi' })}><div className="miniLabel">Team score</div><div className="miniValue">{score}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Pending', kind: 'kpi' })}><div className="miniLabel">Pending tasks</div><div className="miniValue">{pending}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'AI approval rate', kind: 'kpi' })}><div className="miniLabel">AI approval rate</div><div className="miniValue">{aiApprovalRate}%</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Active employees', kind: 'kpi' })}><div className="miniLabel">Active employees</div><div className="miniValue">{activeEmployees}</div></button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Average completion time', kind: 'kpi' })}><div className="miniLabel">Avg completion time</div><div className="miniValue">{avgCompletionDays ? `${avgCompletionDays}d` : '—'}</div></button>
      </div>

      <ChartCard title="Team capacity" subtitle="Rapid insight into assignment balance and remote readiness.">
        <div className="grid4">
          <div className="miniCard"><div className="miniLabel">Capacity index</div><div className="miniValue">{summaryQ.isLoading ? '—' : `${capacityIndex}%`}</div></div>
          <div className="miniCard"><div className="miniLabel">Avg open tasks</div><div className="miniValue">{summaryQ.data?.workload?.averageOpenTasks?.toFixed(1) ?? '0.0'}</div></div>
        </div>
      </ChartCard>

      <div className="grid2">
        <ChartCard title="Task status distribution" subtitle="Current work by status." right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Tasks by status', 'chart')}>Details</button>}>
          <StatusDonutChart byStatus={byStatus} />
        </ChartCard>
        <ChartCard title="Tasks by status" subtitle="Distribution across your scope.">
          <StatusBarChart byStatus={byStatus} />
        </ChartCard>
      </div>

      <div className="grid2">
        <ChartCard title="Deadlines trend" subtitle="Upcoming due tasks vs overdue.">
          <DeadlinesTrendChart points={deadlinePoints} />
        </ChartCard>
      </div>

      <div className="grid2">
        <ChartCard title="Priority mix" subtitle="Task priority distribution.">
          <PriorityPieChart byPriority={byPriority} />
        </ChartCard>
        <ChartCard title="Workload balance" subtitle="Overloaded, balanced, and underutilized team members.">
          <WorkloadBalanceChart fillHeight userCount={summaryQ.data?.userCount ?? 0} workload={summaryQ.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }} />
        </ChartCard>
      </div>

      <ChartCard title="Team performance" subtitle="Score, active workload, and delivery.">
        <AssigneeScoreChart rows={leaderboard.map((u: PerformanceUser) => ({ name: u.name, active: u.active, completed: u.completed, performanceScore: u.performanceScore }))} />
      </ChartCard>

      <Modal title={detail?.title || 'Details'} open={!!detail} wide={detail?.kind === 'chart'} onClose={() => setDetail(null)} footer={<div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}><button type="button" className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} onClick={() => { setDetail(null); navigate('/app/tasks') }}>Open tasks</button></div>}>
        {detail?.kind === 'chart' && detail.title === 'Details limited' ? <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>Your role can view summary charts, but detailed drill-down windows are available for supervisors and above.</div> : null}
        {detail?.kind === 'kpi' ? <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} /> : null}
        {detail?.kind === 'chart' && detail.title === 'Tasks by status' ? <><StatusMiniChart byStatus={byStatus} />{canOpenAdvancedDetails ? <TaskSampleTable tasks={tasks} empty="No tasks." /> : null}</> : null}
        {detail?.kind === 'chart' && detail.title === 'Priority mix' ? <><PriorityBreakdown byPriority={byPriority} />{canOpenAdvancedDetails ? <TaskSampleTable tasks={tasks} empty="No tasks." /> : null}</> : null}
        {detail?.kind === 'chart' && detail.title === 'Team performance' ? <><AssignmentsBreakdownTable rows={assignmentRows} />{canOpenAdvancedDetails ? <TaskSampleTable tasks={tasks} empty="No tasks." /> : null}</> : null}
      </Modal>
      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
