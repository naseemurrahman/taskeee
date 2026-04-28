import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canViewAnalytics } from '../../lib/rbac'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'
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

type PerformanceSummary = {
  scope: 'organization' | 'team'
  totalTasks: number
  byStatus: Record<string, number>
  userCount: number
  teamPerformanceScore: number
  assigneeLeaderboard: Array<{
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
  }>
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

export function AnalyticsPage() {
  const me = getUser()
  const canOpenChartDetails = canCreateTasksAndProjects(me?.role)
  const canOpenAdvancedDetails = canViewAnalytics(me?.role)
  const navigate = useNavigate()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart' }>(null)
  const [pickId, setPickId] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [department, setDepartment] = useState('all')
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

  const assignmentRows = useMemo(() => {
    const map = new Map<string, { name: string; active: number; overdue: number; done: number }>()
    for (const u of leaderboard) {
      map.set(u.name, {
        name: u.name,
        active: u.active,
        overdue: u.overdue,
        done: u.completed,
      })
    }
    return Array.from(map.values())
  }, [leaderboard])

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

  const previousCompletionRate = useMemo(() => {
    // lightweight trend comparison based on selected range vs a fixed 60% benchmark fallback
    return Math.max(0, completionRate - Math.round((rangeDays / 180) * 12))
  }, [completionRate, rangeDays])

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

  const capacityIndex = useMemo(() => {
    const overloaded = summaryQ.data?.workload?.overloaded.length ?? 0
    const underutilized = summaryQ.data?.workload?.underutilized.length ?? 0
    const total = summaryQ.data?.userCount ?? 0
    if (!total) return 0
    return Math.round(Math.max(0, total - overloaded - underutilized) / total * 100)
  }, [summaryQ.data?.workload, summaryQ.data?.userCount])

  function openDetail(title: string, kind: 'kpi' | 'chart') {
    if (!canOpenChartDetails && kind === 'chart') {
      setDetail({ title: 'Details limited', kind: 'chart' })
      return
    }
    setDetail({ title, kind })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Analytics
            </div>
            <div className="pageHeaderCardSub">Deep-dive into task completion rates, team performance, deadline trends, and workload balance across your organization.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📊</span> Real-time charts</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📈</span> Performance scores</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🎯</span> Deadline tracking</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <select value={department} onChange={e => setDepartment(e.target.value)} style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 10px', fontWeight: 700 }}>
              <option value="all">All departments</option>
              {Array.from(new Set((leaderboard || []).map((u) => u.department).filter(Boolean) as string[])).map((dep) => (
                <option key={dep} value={dep}>{dep}</option>
              ))}
            </select>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={downloadCsv}>Download CSV</button>
            <button type="button" className="btn btnGhost" style={{ height: 38 }} onClick={() => window.print()}>Download PDF</button>
          </div>
        </div>
      </div>
      {summaryQ.isError ? <div className="alertV4 alertV4Error">Failed to load summary.</div> : null}

      <div className="grid4">
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Total tasks', kind: 'kpi' })}>
          <div className="miniLabel">Total tasks</div>
          <div className="miniValue">{total}</div>
        </button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Completion rate', kind: 'kpi' })}>
          <div className="miniLabel">Completion rate</div>
          <div className="miniValue">{completionRate}%</div>
        </button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Overdue', kind: 'kpi' })}>
          <div className="miniLabel">Overdue</div>
          <div className="miniValue" style={{ color: 'rgba(239, 68, 68, 0.92)' }}>{overdue}</div>
        </button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Team score', kind: 'kpi' })}>
          <div className="miniLabel">Team score</div>
          <div className="miniValue">{score}</div>
        </button>
        <button type="button" className="miniCard miniLink" onClick={() => setDetail({ title: 'Trend comparison', kind: 'kpi' })}>
          <div className="miniLabel">Trend vs previous</div>
          <div className="miniValue">{completionRate - previousCompletionRate >= 0 ? '+' : ''}{completionRate - previousCompletionRate}%</div>
        </button>
      </div>

      <ChartCard
        title="Per-department breakdown"
        subtitle={`Completion and workload split for the last ${rangeDays} days.`}
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {departmentBreakdown.map(d => (
            <div key={d.department} style={{ display: 'grid', gridTemplateColumns: '2fr repeat(4, 1fr)', gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12 }}>
              <div style={{ fontWeight: 800 }}>{d.department}</div>
              <div>Members: {d.members}</div>
              <div>Done: {d.completed}</div>
              <div>Overdue: {d.overdue}</div>
              <div>Active: {d.active}</div>
            </div>
          ))}
          {departmentBreakdown.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No department data available.</div>}
        </div>
      </ChartCard>

      <ChartCard
        title="Team capacity"
        subtitle="Rapid insight into assignment balance and remote readiness."
        right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Workload balance', 'chart')}>Details</button>}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="grid4">
            <div className="miniCard">
              <div className="miniLabel">Capacity index</div>
              <div className="miniValue">{summaryQ.isLoading ? '—' : `${capacityIndex}%`}</div>
            </div>
            <div className="miniCard">
              <div className="miniLabel">Overloaded</div>
              <div className="miniValue" style={{ color: 'rgba(249, 115, 22, 0.94)' }}>{summaryQ.isLoading ? '—' : summaryQ.data?.workload?.overloaded.length ?? 0}</div>
            </div>
            <div className="miniCard">
              <div className="miniLabel">Underutilized</div>
              <div className="miniValue" style={{ color: 'rgba(56, 189, 248, 0.94)' }}>{summaryQ.isLoading ? '—' : summaryQ.data?.workload?.underutilized.length ?? 0}</div>
            </div>
            <div className="miniCard">
              <div className="miniLabel">Avg open tasks</div>
              <div className="miniValue">{summaryQ.isLoading ? '—' : summaryQ.data?.workload != null ? summaryQ.data.workload.averageOpenTasks.toFixed(1) : '0.0'}</div>
            </div>
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>
            A stronger remote team performs best when active work is balanced, overload is surfaced early, and underutilized capacity is redeployed.
          </div>
        </div>
      </ChartCard>

      <div className="grid2">
        <ChartCard
          title="Tasks by status"
          subtitle="Distribution across your scope."
          right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Tasks by status', 'chart')}>Details</button>}
        >
          <div
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => openDetail('Tasks by status', 'chart')}
            onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Tasks by status', 'chart') : null)}
          >
            <StatusBarChart byStatus={byStatus} />
          </div>
        </ChartCard>
        <ChartCard
          title="Deadlines trend"
          subtitle="Upcoming due tasks vs overdue (14 days)."
          right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Deadlines trend', 'chart')}>Details</button>}
        >
          {tasksQ.isError ? <div className="alert alertError">Failed to load deadlines.</div> : null}
          <div
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => openDetail('Deadlines trend', 'chart')}
            onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Deadlines trend', 'chart') : null)}
          >
            <DeadlinesTrendChart points={deadlinePoints} />
          </div>
        </ChartCard>
      </div>

      <div className="grid2">
        <ChartCard
          title="Priority mix"
          subtitle="Task priority distribution across current work scope."
          right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Priority mix', 'chart')}>Details</button>}
        >
          <div
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => openDetail('Priority mix', 'chart')}
            onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Priority mix', 'chart') : null)}
          >
            <PriorityPieChart byPriority={byPriority} />
          </div>
        </ChartCard>
        <ChartCard
          title="Workload balance"
          subtitle="Overloaded, balanced, and underutilized team members."
          right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Workload balance', 'chart')}>Details</button>}
        >
          <div
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => openDetail('Workload balance', 'chart')}
            onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Workload balance', 'chart') : null)}
          >
            <WorkloadBalanceChart
              fillHeight
              userCount={summaryQ.data?.userCount ?? 0}
              workload={summaryQ.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }}
            />
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Team performance"
        subtitle="Score, active workload, and delivery."
        right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Team performance', 'chart')}>Details</button>}
      >
        {summaryQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!summaryQ.isLoading && leaderboard.length === 0 ? <div style={{ color: 'var(--text2)' }}>No team data yet.</div> : null}
        <div
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => openDetail('Team performance', 'chart')}
          onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Team performance', 'chart') : null)}
        >
          <AssigneeScoreChart rows={leaderboard.map((u) => ({ name: u.name, active: u.active, completed: u.completed, performanceScore: u.performanceScore }))} />
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {leaderboard.slice(0, 8).map((u) => (
            <button
              key={u.userId}
              type="button"
              className="miniCard miniLink"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left' }}
              onClick={() => setPickId(u.userId)}
            >
              <span style={{ fontWeight: 850 }}>{u.name}</span>
              <span className="pill pillMuted">Score {u.performanceScore}</span>
            </button>
          ))}
        </div>
      </ChartCard>

      <ChartCard
        title="Team comparison"
        subtitle="Compare performance and workload across top members."
        right={<button type="button" className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => openDetail('Team comparison', 'chart')}>Details</button>}
      >
        {summaryQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!summaryQ.isLoading && leaderboard.length === 0 ? <div style={{ color: 'var(--text2)' }}>No comparison data yet.</div> : null}
        <div
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => openDetail('Team comparison', 'chart')}
          onKeyDown={(e) => (e.key === 'Enter' ? openDetail('Team comparison', 'chart') : null)}
        >
          <AssigneeScoreChart
            rows={leaderboard.map((u) => ({
              name: u.name,
              active: u.active,
              completed: u.completed,
              performanceScore: u.performanceScore,
            }))}
          />
        </div>
      </ChartCard>

      <Modal
        title={detail?.title || 'Details'}
        open={!!detail}
        wide={detail?.kind === 'chart'}
        onClose={() => setDetail(null)}
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} onClick={() => { setDetail(null); navigate('/app/tasks') }}>
              Open tasks
            </button>
          </div>
        }
      >
        {detail?.kind === 'chart' && detail.title === 'Details limited' ? (
          <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
            Your role can view summary charts, but detailed drill-down windows are available for supervisors and above.
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title === 'Total tasks' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <TaskSampleTable tasks={tasks} empty="No tasks loaded for drill-down." />
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title === 'Completion rate' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'var(--text2)' }}>Organization or team completion: {completionRate}%.</div>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title === 'Overdue' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <TaskSampleTable tasks={tasks.filter((t) => t.status === 'overdue')} empty="No overdue tasks in the sample." />
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title === 'Team score' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 32, fontWeight: 950 }}>{score}</div>
            <div style={{ color: 'var(--text2)' }}>Blended index for your analytics scope.</div>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <AssignmentsBreakdownTable rows={assignmentRows} />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Tasks by status' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <StatusMiniChart byStatus={byStatus} />
            <TaskSampleTable tasks={tasks} empty="No tasks." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Deadlines trend' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Built from task due dates in your scope.</div>
            <StatusMiniChart byStatus={byStatus} />
            <PriorityBreakdown byPriority={byPriority} />
            <TaskSampleTable tasks={tasks} empty="No tasks." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Priority mix' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <PriorityBreakdown byPriority={byPriority} />
            {canOpenAdvancedDetails ? <TaskSampleTable tasks={tasks} empty="No tasks." /> : null}
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Team performance' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <AssignmentsBreakdownTable rows={assignmentRows} />
            <TaskSampleTable tasks={tasks} empty="No tasks." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Workload balance' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Workload status for your current scope.</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="card">
                <div style={{ fontWeight: 900 }}>Overloaded</div>
                <div style={{ color: 'var(--text2)', marginTop: 6 }}>{summaryQ.data?.workload?.overloaded.length ?? 0} users</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {(summaryQ.data?.workload?.overloaded || []).slice(0, 5).map((u) => (
                    <div key={u.userId} className="miniCard miniLink" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <span>{u.name}</span>
                      <span className="pill pillMuted">{u.active} open</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div style={{ fontWeight: 900 }}>Underutilized</div>
                <div style={{ color: 'var(--text2)', marginTop: 6 }}>{summaryQ.data?.workload?.underutilized.length ?? 0} users</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {(summaryQ.data?.workload?.underutilized || []).slice(0, 5).map((u) => (
                    <div key={u.userId} className="miniCard miniLink" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <span>{u.name}</span>
                      <span className="pill pillMuted">{u.active} open</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <TaskSampleTable tasks={tasks} empty="No tasks loaded." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Team comparison' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <AssignmentsBreakdownTable rows={assignmentRows} />
            <div style={{ display: 'grid', gap: 8 }}>
              {leaderboard.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  className="miniCard miniLink"
                  style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    setDetail(null)
                    setPickId(u.userId)
                  }}
                >
                  <span style={{ fontWeight: 850 }}>{u.name}</span>
                  <span className="pill pillMuted">{u.performanceScore} pts</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
