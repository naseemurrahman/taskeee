import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart, StatusBarChart, WorkloadBalanceChart } from '../../components/charts/PerformanceCharts'
import { buildDeadlineSeries } from '../../components/charts/chartUtils'
import { AssignmentsChart, ProjectProgressChart } from '../../components/charts/WorkCharts'
import { useState } from 'react'
import { Modal } from '../../components/Modal'
import { useI18n } from '../../i18n'
import {
  AssignmentsBreakdownTable,
  KpiStrip,
  ModalFooterOpenTasks,
  PriorityBreakdown,
  ProjectsBreakdownTable,
  StatusMiniChart,
  TaskSampleTable,
} from '../../components/insight/InsightBodies'

type Summary = {
  scope: string
  totalTasks: number
  byStatus: Record<string, number>
  teamPerformanceScore: number
  userCount?: number
  workload?: {
    averageOpenTasks: number
    overloaded: Array<{ name: string; active: number; performanceScore: number }>
    underutilized: Array<{ name: string; active: number; performanceScore: number }>
  }
  assigneeLeaderboard?: Array<{
    name: string
    active: number
    completed: number
    performanceScore: number
  }>
}

type Project = { id: string; name: string; color?: string | null; description?: string | null }
type Task = {
  id: string
  title?: string
  status: string
  priority?: string | null
  due_date?: string | null
  category_id?: string | null
  category_name?: string | null
  category_color?: string | null
  assigned_to?: string | null
  assigned_to_name?: string | null
}

function ymdToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymdFromDue(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>(`/api/v1/projects`)
  return d.projects || []
}

async function fetchTasks() {
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?limit=300&page=1`)
  return (d.tasks || d.rows || []) as Task[]
}

export function DashboardHomePage() {
  const { t } = useI18n()
  const user = getUser()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart'; status?: string }>(null)
  const summary = useQuery({
    queryKey: ['performance', 'summary'],
    queryFn: () => apiFetch<Summary>('/api/v1/performance/summary'),
    retry: false,
  })
  const projectsQ = useQuery({ queryKey: ['dashboard', 'projects'], queryFn: fetchProjects })
  const tasksQ = useQuery({ queryKey: ['dashboard', 'tasks'], queryFn: fetchTasks })

  const by = summary.data?.byStatus || {}
  const total = summary.data?.totalTasks ?? 0
  const done = by.completed || 0
  const overdue = by.overdue || 0
  const inProgress = by.in_progress || 0
  const completionPctRaw = total ? Math.round((done / total) * 100) : 0

  const tasks = tasksQ.data || []
  const projects = projectsQ.data || []

  const deadlinePoints = useMemo(() => buildDeadlineSeries(tasks, 7), [tasks])
  const byPriority = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) {
      const p = String(t.priority || '').toLowerCase()
      if (!p) continue
      out[p] = (out[p] || 0) + 1
    }
    return out
  }, [tasks])

  const projectProgress = useMemo(() => {
    const map = new Map<string, { name: string; done: number; remaining: number }>()
    for (const p of projects) map.set(p.id, { name: p.name, done: 0, remaining: 0 })
    for (const t of tasks) {
      const pid = t.category_id
      if (!pid) continue
      const slot = map.get(String(pid))
      if (!slot) continue
      const isDone = t.status === 'completed' || t.status === 'manager_approved'
      if (isDone) slot.done += 1
      else slot.remaining += 1
    }
    return Array.from(map.values())
      .filter((x) => x.done + x.remaining > 0)
      .sort((a, b) => (b.done + b.remaining) - (a.done + a.remaining))
  }, [projects, tasks])

  const capacityIndex = useMemo(() => {
    const overloaded = summary.data?.workload?.overloaded.length ?? 0
    const underutilized = summary.data?.workload?.underutilized.length ?? 0
    const totalUsers = summary.data?.userCount ?? 0
    if (!totalUsers) return 0
    return Math.round(Math.max(0, totalUsers - overloaded - underutilized) / totalUsers * 100)
  }, [summary.data?.workload, summary.data?.userCount])

  const assignments = useMemo(() => {
    const map = new Map<string, { name: string; active: number; overdue: number; done: number }>()
    for (const t of tasks) {
      const name = t.assigned_to_name || 'Unassigned'
      const slot = map.get(name) || { name, active: 0, overdue: 0, done: 0 }
      const isDone = t.status === 'completed' || t.status === 'manager_approved'
      if (isDone) slot.done += 1
      else if (t.status === 'overdue') slot.overdue += 1
      else slot.active += 1
      map.set(name, slot)
    }
    return Array.from(map.values()).sort((a, b) => (b.active + b.overdue + b.done) - (a.active + a.overdue + a.done))
  }, [tasks])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return t('dashboard.greeting.morning')
    if (h < 17) return t('dashboard.greeting.afternoon')
    return t('dashboard.greeting.evening')
  }, [t])

  const overdueTasks = useMemo(() => tasks.filter((t) => t.status === 'overdue').slice(0, 6), [tasks])
  const dueSoon = useMemo(() => {
    const now = Date.now()
    const in7d = now + 7 * 86400000
    return tasks
      .filter((t) => t.due_date && !['completed', 'manager_approved'].includes(t.status))
      .map((t) => ({ ...t, dueTs: new Date(String(t.due_date)).getTime() }))
      .filter((t) => Number.isFinite((t as any).dueTs) && (t as any).dueTs >= now && (t as any).dueTs <= in7d)
      .sort((a: any, b: any) => a.dueTs - b.dueTs)
      .slice(0, 6)
  }, [tasks])

  const dueToday = useMemo(() => {
    const key = ymdToday()
    return tasks.filter((t) => {
      if (!t.due_date || ['completed', 'manager_approved'].includes(t.status)) return false
      return ymdFromDue(String(t.due_date)) === key
    })
  }, [tasks])

  const myOpenTasks = useMemo(() => {
    const uid = user?.id
    if (!uid) return []
    return tasks.filter((t) => t.assigned_to === uid && !['completed', 'manager_approved'].includes(t.status)).slice(0, 5)
  }, [tasks, user?.id])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: '-0.8px' }}>
            {greeting}{user?.fullName ? `, ${user.fullName}` : ''}
          </div>
          <div style={{ color: 'var(--text2)', marginTop: 4 }}>
            {t('dashboard.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost" to="/app/jeczone">
            {t('dashboard.jeczone')}
          </Link>
        </div>
      </div>

      <div className="dashGrid">
        <div className="dashMainCol" style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <div className="grid4">
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.totalTasks'), kind: 'kpi' })} type="button">
                <div className="miniLabel">{t('dashboard.totalTasks')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : total}</div>
              </button>
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.inProgress'), kind: 'kpi', status: 'in_progress' })} type="button">
                <div className="miniLabel">{t('dashboard.inProgress')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : inProgress}</div>
              </button>
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.completed'), kind: 'kpi', status: 'completed' })} type="button">
                <div className="miniLabel">{t('dashboard.completed')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : done}</div>
              </button>
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.overdue'), kind: 'kpi', status: 'overdue' })} type="button">
                <div className="miniLabel">{t('dashboard.overdue')}</div>
                <div className="miniValue" style={{ color: 'rgba(239, 68, 68, 0.92)' }}>{summary.isLoading ? '—' : overdue}</div>
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.completion'), kind: 'kpi' })} type="button">
                <div className="miniLabel">{t('dashboard.completion')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : `${completionPctRaw}%`}</div>
              </button>
              <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.teamScore'), kind: 'kpi' })} type="button">
                <div className="miniLabel">{t('dashboard.teamScore')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : Math.round(summary.data?.teamPerformanceScore || 0)}</div>
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>Team capacity</div>
                <div style={{ color: 'var(--text2)', marginTop: 4 }}>Track assignment balance and workload pressure across active members.</div>
              </div>
              <Link className="btn btnGhost btnSm" to="/app/analytics">
                Analytics
              </Link>
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div className="grid4">
                <div className="miniCard">
                  <div className="miniLabel">{t('dashboard.balanced')}</div>
                  <div className="miniValue">{summary.isLoading ? '—' : `${capacityIndex}%`}</div>
                </div>
                <div className="miniCard">
                  <div className="miniLabel">{t('dashboard.overloaded')}</div>
                  <div className="miniValue" style={{ color: 'rgba(249, 115, 22, 0.94)' }}>{summary.isLoading ? '—' : summary.data?.workload?.overloaded.length ?? 0}</div>
                </div>
                <div className="miniCard">
                  <div className="miniLabel">{t('dashboard.underutilized')}</div>
                  <div className="miniValue" style={{ color: 'rgba(56, 189, 248, 0.94)' }}>{summary.isLoading ? '—' : summary.data?.workload?.underutilized.length ?? 0}</div>
                </div>
                <div className="miniCard">
                  <div className="miniLabel">{t('dashboard.avgOpenTasks')}</div>
                  <div className="miniValue">{summary.isLoading ? '—' : summary.data?.workload != null ? summary.data.workload.averageOpenTasks.toFixed(1) : '0.0'}</div>
                </div>
              </div>
              <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>
                Teams with higher remote readiness benefit from balanced load and clear capacity signals. Keep overloaded users supported and underutilized members engaged with short-term work.
              </div>
            </div>
          </div>

          {summary.isError ? (
            <div className="card dashSummaryFallback">
              <div style={{ fontWeight: 800 }}>Team summary unavailable</div>
              <div style={{ color: 'var(--text2)', marginTop: 6, fontSize: 14, lineHeight: 1.45 }}>
                Your role may not include org-wide metrics, or the service was unreachable. KPI tiles may show “—”; charts still use tasks loaded for your account.
              </div>
            </div>
          ) : null}

          <div className="grid2 dashFocusRow">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{t('dashboard.dueToday')}</div>
                <Link className="btn btnGhost btnSm" to="/app/calendar">
                  {t('dashboard.calendar')}
                </Link>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {dueToday.length === 0 ? (
                  <div className="dashEmptyWell">
                    <div className="dashEmptyTitle">{t('dashboard.noDueTodayTitle')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noDueTodayBody')}</div>
                    <div className="dashEmptyActions" style={{ marginTop: 10 }}>
                      <Link className="btn btnGhost btnSm" to="/app/board">
                        Board
                      </Link>
                      <Link className="btn btnPrimary btnSm" to="/app/tasks">
                        All tasks
                      </Link>
                    </div>
                  </div>
                ) : (
                  dueToday.map((t) => (
                    <div
                      key={t.id}
                      className="miniCard"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        alignItems: 'center',
                        borderLeft: `4px solid ${t.category_color?.trim() || 'rgba(244, 202, 87, 0.85)'}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.id}</div>
                        <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{t.category_name || t.status}</div>
                      </div>
                      <span className="pill pillMuted">{t.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{t('dashboard.myOpenTasks')}</div>
                <Link className="btn btnGhost btnSm" to="/app/tasks">
                  {t('dashboard.openList')}
                </Link>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {myOpenTasks.length === 0 ? (
                  <div className="dashEmptyWell">
                    <div className="dashEmptyTitle">{t('dashboard.noAssignmentsTitle')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noAssignmentsBody')}</div>
                  </div>
                ) : (
                  myOpenTasks.map((t) => (
                    <div
                      key={t.id}
                      className="miniCard"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        alignItems: 'center',
                        borderLeft: `4px solid ${t.category_color?.trim() || 'rgba(109, 94, 252, 0.65)'}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.id}</div>
                        <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{t.priority || 'medium'} priority</div>
                      </div>
                      <span className="pill pillMuted">{t.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {summary.data?.assigneeLeaderboard && summary.data.assigneeLeaderboard.length > 0 ? (
            <ChartCard
              fillHeight
              title="Employee performance"
              subtitle="Score, active load, and completions by person (in your scope)."
              right={<Link className="btn btnGhost" to="/app/analytics">Analytics</Link>}
            >
              <AssigneeScoreChart
                fillHeight
                rows={summary.data.assigneeLeaderboard.slice(0, 10).map((x) => ({
                  name: x.name,
                  active: x.active,
                  completed: x.completed,
                  performanceScore: x.performanceScore,
                }))}
              />
            </ChartCard>
          ) : null}

          <div className="grid2 dashChartRow dashChartRowStretch">
        <ChartCard
          fillHeight
          title="Projects statistics"
          subtitle="Completion and throughput by project."
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Projects statistics', kind: 'chart' })} type="button">{t('dashboard.details')}</button>
              <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to="/app/projects">View</Link>
            </div>
          }
        >
          <div className="chartClickSlot" role="button" tabIndex={0} onClick={() => setDetail({ title: 'Projects statistics', kind: 'chart' })} onKeyDown={(e) => e.key === 'Enter' ? setDetail({ title: 'Projects statistics', kind: 'chart' }) : null}>
          {tasksQ.isLoading ? <div className="chartSlotLoading" style={{ color: 'var(--text2)' }}>Loading…</div> : null}
          {!tasksQ.isLoading && tasks.length === 0 ? (
            <div className="chartSlotLoading" style={{ color: 'var(--text2)', textAlign: 'center', padding: 18 }}>
              <div>
                <div style={{ fontWeight: 900 }}>No data yet</div>
                <div style={{ marginTop: 6 }}>Create your first task to unlock charts and progress.</div>
              </div>
            </div>
          ) : (
            <ProjectProgressChart fillHeight rows={projectProgress.map((p) => ({ name: p.name, done: p.done, remaining: p.remaining }))} />
          )}
          </div>
        </ChartCard>

        <ChartCard
          fillHeight
          title="Task assignments"
          subtitle="Workload split by assignee (active/overdue/done)."
          right={<button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Task assignments', kind: 'chart' })} type="button">{t('dashboard.details')}</button>}
        >
          <div className="chartClickSlot" role="button" tabIndex={0} onClick={() => setDetail({ title: 'Task assignments', kind: 'chart' })} onKeyDown={(e) => e.key === 'Enter' ? setDetail({ title: 'Task assignments', kind: 'chart' }) : null}>
          {tasksQ.isLoading ? <div className="chartSlotLoading" style={{ color: 'var(--text2)' }}>Loading…</div> : null}
          {!tasksQ.isLoading && tasks.length === 0 ? (
            <div className="chartSlotLoading" style={{ color: 'var(--text2)' }}>No assignments yet.</div>
          ) : (
            <AssignmentsChart fillHeight rows={assignments.map((a) => ({ name: a.name, active: a.active, overdue: a.overdue, done: a.done }))} />
          )}
          </div>
        </ChartCard>
          </div>

          <div className="grid2 dashChartRowStretch">
            <ChartCard
              fillHeight
              title="Deadlines"
              subtitle="Next 7 days due vs overdue."
              right={<button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Deadlines', kind: 'chart' })} type="button">{t('dashboard.details')}</button>}
            >
              <div className="chartClickSlot" role="button" tabIndex={0} onClick={() => setDetail({ title: 'Deadlines', kind: 'chart' })} onKeyDown={(e) => e.key === 'Enter' ? setDetail({ title: 'Deadlines', kind: 'chart' }) : null}>
                <DeadlinesTrendChart fillHeight points={deadlinePoints} />
              </div>
            </ChartCard>
            <ChartCard
              fillHeight
              title="Status overview"
              subtitle="Workspace status distribution."
              right={<button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Status overview', kind: 'chart' })} type="button">{t('dashboard.details')}</button>}
            >
              <div className="chartClickSlot" role="button" tabIndex={0} onClick={() => setDetail({ title: 'Status overview', kind: 'chart' })} onKeyDown={(e) => e.key === 'Enter' ? setDetail({ title: 'Status overview', kind: 'chart' }) : null}>
                <StatusBarChart fillHeight byStatus={by} />
              </div>
            </ChartCard>
          </div>

          <ChartCard
            fillHeight
            title="Priority mix"
            subtitle="Distribution of task priority."
            right={<button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Priority mix', kind: 'chart' })} type="button">{t('dashboard.details')}</button>}
          >
            <div
              className="chartClickSlot"
              role="button"
              tabIndex={0}
              onClick={() => setDetail({ title: 'Priority mix', kind: 'chart' })}
              onKeyDown={(e) => (e.key === 'Enter' ? setDetail({ title: 'Priority mix', kind: 'chart' }) : null)}
            >
              <PriorityPieChart fillHeight byPriority={byPriority} />
            </div>
          </ChartCard>

          <ChartCard
            fillHeight
            title="Workload balance"
            subtitle="Overloaded vs underutilized members in scope."
            right={<button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => setDetail({ title: 'Workload balance', kind: 'chart' })} type="button">{t('dashboard.details')}</button>}
          >
            <div
              className="chartClickSlot"
              role="button"
              tabIndex={0}
              onClick={() => setDetail({ title: 'Workload balance', kind: 'chart' })}
              onKeyDown={(e) => (e.key === 'Enter' ? setDetail({ title: 'Workload balance', kind: 'chart' }) : null)}
            >
              <WorkloadBalanceChart
                fillHeight
                userCount={summary.data?.userCount ?? 0}
                workload={summary.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }}
              />
            </div>
          </ChartCard>

          <div className="dashWidgetRow">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.4px' }}>{t('dashboard.overdue')}</div>
                <button className="btn btnGhost btnSm" type="button" onClick={() => navigate('/app/tasks?status=overdue')}>
                  {t('dashboard.openTasks')}
                </button>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                {overdueTasks.length === 0 ? (
                  <div className="dashEmptyWell dashEmptyWellCompact">
                    <div className="dashEmptyTitle">{t('dashboard.noDueTodayTitle')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noDueTodayBody')}</div>
                    <div className="dashEmptyActions" style={{ marginTop: 8 }}>
                      <button type="button" className="btn btnGhost btnSm" onClick={() => navigate('/app/calendar')}>
                        {t('dashboard.calendar')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {overdueTasks.map((t) => (
                  <div
                    key={t.id}
                    className="miniCard"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      alignItems: 'center',
                      borderLeft: `4px solid ${t.category_color?.trim() || 'rgba(239, 68, 68, 0.75)'}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.id}</div>
                      <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{t.assigned_to_name || '—'}</div>
                    </div>
                    <span className="pill pillMuted">Overdue</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.4px' }}>{t('dashboard.deadlines')}</div>
                <button className="btn btnGhost btnSm" type="button" onClick={() => setDetail({ title: 'Due soon', kind: 'chart' })}>
                  Details
                </button>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                {dueSoon.length === 0 ? (
                  <div className="dashEmptyWell dashEmptyWellCompact">
                    <div className="dashEmptyTitle">{t('dashboard.noDataYet')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noTasksLoaded')}</div>
                    <div className="dashEmptyActions" style={{ marginTop: 8 }}>
                      <button type="button" className="btn btnGhost btnSm" onClick={() => navigate('/app/tasks')}>
                        {t('dashboard.openList')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {dueSoon.map((t: any) => (
                  <div
                    key={t.id}
                    className="miniCard"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      alignItems: 'center',
                      borderLeft: `4px solid ${String(t.category_color || '').trim() || 'rgba(56, 189, 248, 0.75)'}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.id}</div>
                      <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>
                        Due {new Date(String(t.due_date)).toLocaleDateString()} · {t.assigned_to_name || '—'}
                      </div>
                    </div>
                    <span className="pill pillMuted">{String(t.priority || 'medium')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        title={detail?.title || 'Details'}
        open={!!detail}
        onClose={() => setDetail(null)}
        wide={detail?.kind === 'chart'}
        footer={
          detail?.kind === 'kpi' &&
          detail.title !== 'Completion rate' &&
          detail.title !== 'Team score' ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btnPrimary"
                style={{ height: 40, padding: '0 12px', width: 'auto', minWidth: 0 }}
                onClick={() => {
                  if (!detail) return
                  const status = detail.status
                  setDetail(null)
                  navigate(status ? `/app/tasks?status=${encodeURIComponent(status)}` : '/app/tasks')
                }}
                type="button"
              >
                {t('dashboard.openTasks')}
              </button>
            </div>
          ) : detail?.kind === 'kpi' && detail.title === 'Completion rate' ? (
            <ModalFooterOpenTasks href="/app/tasks" onClose={() => setDetail(null)} />
          ) : detail?.kind === 'kpi' && detail.title === 'Team score' ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btnPrimary"
                style={{ height: 40, padding: '0 12px', width: 'auto', minWidth: 0 }}
                onClick={() => {
                  setDetail(null)
                  navigate('/app/analytics')
                }}
                type="button"
              >
                {t('dashboard.analytics')}
              </button>
            </div>
          ) : detail?.kind === 'chart' ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                className="btn btnGhost"
                style={{ height: 40, padding: '0 12px', width: 'auto', minWidth: 0 }}
                onClick={() => {
                  setDetail(null)
                  navigate('/app/analytics')
                }}
                type="button"
              >
                {t('dashboard.analytics')}
              </button>
              <button
                className="btn btnPrimary"
                style={{ height: 40, padding: '0 12px', width: 'auto', minWidth: 0 }}
                onClick={() => {
                  setDetail(null)
                  navigate('/app/tasks')
                }}
                type="button"
              >
                Open tasks
              </button>
            </div>
          ) : null
        }
      >
        {detail?.kind === 'kpi' && detail.title === 'Completion rate' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'var(--text2)' }}>
              Completed {done}/{total} tasks ({completionPctRaw}% completion) within your current workspace scope.
            </div>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <TaskSampleTable
              tasks={tasks.filter((t) => t.status === 'completed' || t.status === 'manager_approved')}
              empty="No completed tasks in this view."
            />
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title === 'Team score' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'var(--text2)' }}>
              Aggregate performance score: <strong>{Math.round(summary.data?.teamPerformanceScore || 0)}</strong>. It blends
              completion, on-time delivery, rejections, and overdue pressure for everyone in scope.
            </div>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Open Analytics for per-person breakdown and comparison charts.</div>
          </div>
        ) : null}
        {detail?.kind === 'kpi' && detail.title !== 'Completion rate' && detail.title !== 'Team score' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: 'var(--text2)' }}>
              {detail.status ? `Showing a quick summary for status: ${detail.status}` : 'Showing a quick summary for all tasks.'}
            </div>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            <TaskSampleTable
              tasks={detail.status ? tasks.filter((t) => t.status === detail.status) : tasks}
              empty="No rows for this slice."
            />
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Tip: use “Open tasks” to see the full list with filters.
            </div>
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Projects statistics' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Throughput and completion by project (from tasks linked to projects).</div>
            <ProjectsBreakdownTable rows={projectProgress.map((p) => ({ name: p.name, done: p.done, remaining: p.remaining }))} />
            <TaskSampleTable tasks={tasks} empty="No tasks loaded." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Task assignments' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Workload by assignee in your scope.</div>
            <AssignmentsBreakdownTable
              rows={assignments.map((a) => ({ name: a.name, active: a.active, overdue: a.overdue, done: a.done }))}
            />
            <TaskSampleTable tasks={tasks} empty="No tasks loaded." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Deadlines' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Due volume vs overdue for the next week.</div>
            <StatusMiniChart byStatus={by} />
            <TaskSampleTable
              tasks={tasks.filter((t) => t.due_date && !['completed', 'manager_approved'].includes(t.status))}
              empty="No upcoming dated tasks."
            />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Status overview' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <StatusMiniChart byStatus={by} />
            <TaskSampleTable tasks={tasks} empty="No tasks loaded." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Priority mix' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <PriorityBreakdown byPriority={byPriority} />
            <TaskSampleTable tasks={tasks} empty="No tasks loaded." />
          </div>
        ) : null}
        {detail?.kind === 'chart' && detail.title === 'Workload balance' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Workload status for your current task scope.</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="card">
                <div style={{ fontWeight: 900 }}>Overloaded</div>
                <div style={{ color: 'var(--text2)', marginTop: 6 }}>{summary.data?.workload?.overloaded.length ?? 0} users</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {(summary.data?.workload?.overloaded || []).slice(0, 5).map((u) => (
                    <div key={u.name} className="miniCard miniLink" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <span>{u.name}</span>
                      <span className="pill pillMuted">{u.active} open</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div style={{ fontWeight: 900 }}>Underutilized</div>
                <div style={{ color: 'var(--text2)', marginTop: 6 }}>{summary.data?.workload?.underutilized.length ?? 0} users</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {(summary.data?.workload?.underutilized || []).slice(0, 5).map((u) => (
                    <div key={u.name} className="miniCard miniLink" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
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
        {detail?.kind === 'chart' && detail.title === 'Due soon' ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: 'var(--text2)' }}>Tasks due within the next 7 days.</div>
            <TaskSampleTable tasks={dueSoon as unknown as Task[]} empty="Nothing due soon." />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

