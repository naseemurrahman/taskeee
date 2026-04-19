import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { ChartCard } from '../../components/charts/ChartCard'
import {
  AssigneeScoreChart,
  DeadlinesTrendChart,
  PriorityPieChart,
  StatusBarChart,
  WorkloadBalanceChart,
} from '../../components/charts/PerformanceCharts'
import { buildDeadlineSeries } from '../../components/charts/chartUtils'
import { AssignmentsChart, ProjectProgressChart } from '../../components/charts/WorkCharts'
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
      .sort((a, b) => b.done + b.remaining - (a.done + a.remaining))
  }, [projects, tasks])

  const capacityIndex = useMemo(() => {
    const ol = summary.data?.workload?.overloaded.length ?? 0
    const ul = summary.data?.workload?.underutilized.length ?? 0
    const totalUsers = summary.data?.userCount ?? 0
    if (!totalUsers) return 0
    return Math.round(Math.max(0, totalUsers - ol - ul) / totalUsers * 100)
  }, [summary.data])

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
    return Array.from(map.values()).sort((a, b) => b.active + b.overdue + b.done - (a.active + a.overdue + a.done))
  }, [tasks])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return t('dashboard.greeting.morning')
    if (h < 17) return t('dashboard.greeting.afternoon')
    return t('dashboard.greeting.evening')
  }, [t])

  const today = ymdToday()
  const dueToday = useMemo(
    () => tasks.filter((t) => {
      if (!t.due_date || ['completed', 'manager_approved'].includes(t.status)) return false
      return ymdFromDue(String(t.due_date)) === today
    }),
    [tasks, today],
  )

  const myOpenTasks = useMemo(() => {
    const uid = user?.id
    if (!uid) return []
    return tasks
      .filter((t) => t.assigned_to === uid && !['completed', 'manager_approved'].includes(t.status))
      .slice(0, 5)
  }, [tasks, user?.id])

  const hour = new Date().getHours()
  const greetEmoji = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙'

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: '-0.8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{greetEmoji}</span>
            {greeting}{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}
          </div>
          <div style={{ color: 'var(--text2)', marginTop: 4, fontSize: 14 }}>
            {t('dashboard.subtitle')} &nbsp;·&nbsp;
            <span style={{ color: overdue > 0 ? 'rgba(239,68,68,0.85)' : 'var(--success)', fontWeight: 800 }}>
              {overdue > 0 ? `${overdue} overdue` : 'All caught up ✓'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost btnSm" to="/app/my-tasks">My tasks</Link>
          <Link className="btn btnGhost btnSm" to="/app/board">Board</Link>
          <Link className="btn btnPrimary btnSm" to="/app/jeczone">{t('dashboard.jeczone')}</Link>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        {[
          { label: t('dashboard.totalTasks'), value: total, color: 'var(--text)', status: undefined },
          { label: t('dashboard.inProgress'), value: inProgress, color: '#f4ca57', status: 'in_progress' },
          { label: t('dashboard.completed'), value: done, color: 'var(--success)', status: 'completed' },
          { label: t('dashboard.overdue'), value: overdue, color: overdue > 0 ? 'var(--danger)' : 'var(--success)', status: 'overdue' },
        ].map((kpi) => (
          <button
            key={kpi.label}
            className="miniCard miniLink"
            onClick={() => setDetail({ title: kpi.label, kind: 'kpi', status: kpi.status })}
            type="button"
            style={{ textAlign: 'left', position: 'relative', overflow: 'hidden' }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: kpi.color, opacity: 0.7, borderRadius: '4px 4px 0 0' }} />
            <div className="miniLabel">{kpi.label}</div>
            <div className="miniValue" style={{ color: kpi.color }}>{summary.isLoading ? '—' : kpi.value}</div>
          </button>
        ))}
      </div>

      {/* ── Completion + Score ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.completion'), kind: 'kpi' })} type="button" style={{ textAlign: 'left' }}>
          <div className="miniLabel">{t('dashboard.completion')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <div className="miniValue" style={{ color: 'var(--accent)' }}>{summary.isLoading ? '—' : `${completionPctRaw}%`}</div>
            {!summary.isLoading && (
              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${completionPctRaw}%`, background: 'var(--accent)', borderRadius: 3 }} />
              </div>
            )}
          </div>
        </button>
        <button className="miniCard miniLink" onClick={() => setDetail({ title: t('dashboard.teamScore'), kind: 'kpi' })} type="button" style={{ textAlign: 'left' }}>
          <div className="miniLabel">{t('dashboard.teamScore')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <div className="miniValue" style={{ color: '#10b981' }}>{summary.isLoading ? '—' : Math.round(summary.data?.teamPerformanceScore || 0)}</div>
            {!summary.isLoading && (
              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.round(summary.data?.teamPerformanceScore || 0))}%`, background: '#10b981', borderRadius: 3 }} />
              </div>
            )}
          </div>
        </button>
      </div>

      <div className="dashGrid">
        <div className="dashMainCol" style={{ display: 'grid', gap: 14 }}>

          {/* ── Team capacity ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>Team capacity</div>
                <div style={{ color: 'var(--text2)', marginTop: 4, fontSize: 13 }}>Assignment balance and workload pressure across active members.</div>
              </div>
              <Link className="btn btnGhost btnSm" to="/app/analytics">Analytics →</Link>
            </div>
            <div className="grid4" style={{ marginTop: 12 }}>
              <div className="miniCard">
                <div className="miniLabel">{t('dashboard.balanced')}</div>
                <div className="miniValue" style={{ color: '#10b981' }}>{summary.isLoading ? '—' : `${capacityIndex}%`}</div>
              </div>
              <div className="miniCard">
                <div className="miniLabel">{t('dashboard.overloaded')}</div>
                <div className="miniValue" style={{ color: 'rgba(249,115,22,0.94)' }}>{summary.isLoading ? '—' : summary.data?.workload?.overloaded.length ?? 0}</div>
              </div>
              <div className="miniCard">
                <div className="miniLabel">{t('dashboard.underutilized')}</div>
                <div className="miniValue" style={{ color: 'rgba(56,189,248,0.94)' }}>{summary.isLoading ? '—' : summary.data?.workload?.underutilized.length ?? 0}</div>
              </div>
              <div className="miniCard">
                <div className="miniLabel">{t('dashboard.avgOpenTasks')}</div>
                <div className="miniValue">{summary.isLoading ? '—' : summary.data?.workload != null ? summary.data.workload.averageOpenTasks.toFixed(1) : '0.0'}</div>
              </div>
            </div>
          </div>

          {summary.isError ? (
            <div className="card dashSummaryFallback">
              <div style={{ fontWeight: 800 }}>Team summary unavailable</div>
              <div style={{ color: 'var(--text2)', marginTop: 6, fontSize: 14, lineHeight: 1.45 }}>
                Your role may not include org-wide metrics, or the service was unreachable.
              </div>
            </div>
          ) : null}

          <div className="grid2 dashFocusRow">
            {/* Due today */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{t('dashboard.dueToday')}</div>
                <Link className="btn btnGhost btnSm" to="/app/calendar">{t('dashboard.calendar')}</Link>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {dueToday.length === 0 ? (
                  <div className="dashEmptyWell">
                    <div className="dashEmptyTitle">{t('dashboard.noDueTodayTitle')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noDueTodayBody')}</div>
                    <div className="dashEmptyActions" style={{ marginTop: 10 }}>
                      <Link className="btn btnGhost btnSm" to="/app/board">Board</Link>
                      <Link className="btn btnPrimary btnSm" to="/app/tasks">All tasks</Link>
                    </div>
                  </div>
                ) : dueToday.map((task) => (
                  <div
                    key={task.id}
                    className="miniCard"
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', borderLeft: `4px solid ${task.category_color?.trim() || 'rgba(244,202,87,0.85)'}` }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || task.id}</div>
                      <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{task.category_name || task.status}</div>
                    </div>
                    <span className="pill pillMuted">{task.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* My open tasks */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{t('dashboard.myOpenTasks')}</div>
                <Link className="btn btnGhost btnSm" to="/app/my-tasks">{t('dashboard.viewAll')}</Link>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {myOpenTasks.length === 0 ? (
                  <div className="dashEmptyWell">
                    <div className="dashEmptyTitle">{t('dashboard.noMyTasksTitle')}</div>
                    <div className="dashEmptyBody">{t('dashboard.noMyTasksBody')}</div>
                  </div>
                ) : myOpenTasks.map((task) => (
                  <div key={task.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || task.id}</div>
                      <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{task.category_name || '—'}</div>
                    </div>
                    <span className="pill pillMuted">{task.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Charts ── */}
          <div className="grid2">
            <ChartCard title={t('dashboard.statusBreakdown')}>
              <StatusBarChart byStatus={by} />
            </ChartCard>
            <ChartCard title={t('dashboard.priorityBreakdown')}>
              <PriorityPieChart byPriority={byPriority} />
            </ChartCard>
          </div>

          <ChartCard title={t('dashboard.deadlinesTrend')}>
            <DeadlinesTrendChart points={deadlinePoints} />
          </ChartCard>

          <ChartCard title={t('dashboard.projectProgress')}>
            <ProjectProgressChart rows={projectProgress} />
          </ChartCard>

          <ChartCard title={t('dashboard.assignmentBreakdown')}>
            <AssignmentsChart rows={assignments} />
          </ChartCard>
        </div>

        {/* ── Right sidebar ── */}
        <div className="dashSideCol" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <ChartCard title={t('dashboard.workloadBalance')}>
            <WorkloadBalanceChart
              workload={summary.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }}
              userCount={summary.data?.userCount ?? 0}
            />
          </ChartCard>

          <ChartCard title={t('dashboard.performanceLeaderboard')}>
            <AssigneeScoreChart rows={summary.data?.assigneeLeaderboard ?? []} />
          </ChartCard>

          {/* Quick nav */}
          <div className="card">
            <div style={{ fontWeight: 950, letterSpacing: '-0.3px', marginBottom: 10 }}>Quick access</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {[
                { label: 'Tasks', to: '/app/tasks' },
                { label: 'Board', to: '/app/board' },
                { label: 'Projects', to: '/app/projects' },
                { label: 'Calendar', to: '/app/calendar' },
                { label: 'Analytics', to: '/app/analytics' },
                { label: 'Reports', to: '/app/reports' },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'var(--text2)', textDecoration: 'none', fontSize: 13, fontWeight: 700,
                    transition: 'all 0.15s',
                  }}
                >
                  {item.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail modal ── */}
      {detail ? (
        <Modal title={detail.title} open={!!detail} onClose={() => setDetail(null)}>
          {detail.kind === 'kpi' ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <KpiStrip
                total={total}
                inProgress={inProgress}
                completed={done}
                overdue={overdue}
              />
              {detail.status ? (
                <TaskSampleTable tasks={tasks.filter((t) => t.status === detail.status)} />
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <StatusMiniChart byStatus={by} />
                  <PriorityBreakdown byPriority={byPriority} />
                  <AssignmentsBreakdownTable rows={assignments} />
                  <ProjectsBreakdownTable rows={projectProgress} />
                </div>
              )}
              <ModalFooterOpenTasks href="/app/tasks" onClose={() => setDetail(null)} />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <StatusBarChart byStatus={by} />
              <PriorityPieChart byPriority={byPriority} />
              <DeadlinesTrendChart points={deadlinePoints} />
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  )
}
