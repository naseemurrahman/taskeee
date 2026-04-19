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
  AssignmentsBreakdownTable, KpiStrip, ModalFooterOpenTasks,
  PriorityBreakdown, ProjectsBreakdownTable, StatusMiniChart, TaskSampleTable,
} from '../../components/insight/InsightBodies'

type Summary = {
  scope: string; totalTasks: number; byStatus: Record<string, number>
  teamPerformanceScore: number; userCount?: number
  workload?: { averageOpenTasks: number; overloaded: any[]; underutilized: any[] }
  assigneeLeaderboard?: Array<{ name: string; active: number; completed: number; performanceScore: number }>
}
type Project = { id: string; name: string; color?: string | null }
type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
}

function ymdToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function ymdFromDue(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
  return d.projects || []
}
async function fetchTasks() {
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>('/api/v1/tasks?limit=300&page=1')
  return (d.tasks || d.rows || []) as Task[]
}

// KPI icon components
function IconTasks() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>
}
function IconProgress() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
function IconDone() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}
function IconOverdue() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}

interface KpiCardProps {
  label: string; value: number | string; icon: React.ReactNode
  iconBg: string; iconColor: string; accentColor: string
  trend?: string; trendUp?: boolean; sub?: string; pct?: number
  onClick?: () => void; loading?: boolean
}
function KpiCardV2(p: KpiCardProps) {
  return (
    <div className="kpiCard" onClick={p.onClick} role={p.onClick ? 'button' : undefined} tabIndex={p.onClick ? 0 : undefined}>
      <div className="kpiCardTop">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1 }}>
          <div className="kpiCardIcon" style={{ background: p.iconBg, color: p.iconColor }}>
            {p.icon}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="kpiCardLabel">{p.label}</div>
            <div className="kpiCardVal" style={{ color: p.accentColor }}>
              {p.loading ? <span style={{ fontSize: 18, opacity: 0.5 }}>—</span> : p.value}
            </div>
          </div>
        </div>
        {p.trend && !p.loading && (
          <span className={`trendBadge ${p.trendUp ? 'trendPos' : 'trendNeg'}`} style={{ flexShrink: 0 }}>
            {p.trendUp ? '↑' : '↓'} {p.trend}
          </span>
        )}
      </div>
      {p.sub && <div className="kpiCardSub">{p.sub}</div>}
      {p.pct !== undefined && (
        <div className="kpiCardBar">
          <div className="kpiCardBarFill" style={{ width: `${Math.min(100, p.pct)}%`, background: p.accentColor }} />
        </div>
      )}
    </div>
  )
}

export function DashboardHomePage() {
  const { t } = useI18n()
  const user = getUser()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart'; status?: string }>(null)

  const summary = useQuery({ queryKey: ['performance','summary'], queryFn: () => apiFetch<Summary>('/api/v1/performance/summary'), retry: false })
  const projectsQ = useQuery({ queryKey: ['dashboard','projects'], queryFn: fetchProjects })
  const tasksQ = useQuery({ queryKey: ['dashboard','tasks'], queryFn: fetchTasks })

  const by = summary.data?.byStatus || {}
  const total = summary.data?.totalTasks ?? 0
  const done = by.completed || 0
  const overdue = by.overdue || 0
  const inProgress = by.in_progress || 0
  const completionPct = total ? Math.round((done / total) * 100) : 0
  const score = Math.round(summary.data?.teamPerformanceScore || 0)

  const tasks = tasksQ.data || []
  const projects = projectsQ.data || []

  const deadlinePoints = useMemo(() => buildDeadlineSeries(tasks, 7), [tasks])

  const byPriority = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) {
      const p = String(t.priority || '').toLowerCase()
      if (p) out[p] = (out[p] || 0) + 1
    }
    return out
  }, [tasks])

  const projectProgress = useMemo(() => {
    const map = new Map<string, { name: string; done: number; remaining: number }>()
    for (const p of projects) map.set(p.id, { name: p.name, done: 0, remaining: 0 })
    for (const t of tasks) {
      const pid = t.category_id; if (!pid) continue
      const slot = map.get(String(pid)); if (!slot) continue
      const isDone = t.status === 'completed' || t.status === 'manager_approved'
      if (isDone) slot.done++; else slot.remaining++
    }
    return Array.from(map.values()).filter(x => x.done + x.remaining > 0)
      .sort((a, b) => b.done + b.remaining - (a.done + a.remaining))
  }, [projects, tasks])

  const assignments = useMemo(() => {
    const map = new Map<string, { name: string; active: number; overdue: number; done: number }>()
    for (const t of tasks) {
      const name = t.assigned_to_name || 'Unassigned'
      const slot = map.get(name) || { name, active: 0, overdue: 0, done: 0 }
      const isDone = t.status === 'completed' || t.status === 'manager_approved'
      if (isDone) slot.done++
      else if (t.status === 'overdue') slot.overdue++
      else slot.active++
      map.set(name, slot)
    }
    return Array.from(map.values()).sort((a, b) => b.active + b.overdue + b.done - (a.active + a.overdue + a.done))
  }, [tasks])

  const today = ymdToday()
  const dueToday = useMemo(() => tasks.filter(t => {
    if (!t.due_date || ['completed','manager_approved'].includes(t.status)) return false
    return ymdFromDue(String(t.due_date)) === today
  }), [tasks, today])

  const myOpenTasks = useMemo(() => {
    const uid = user?.id; if (!uid) return []
    return tasks.filter(t => t.assigned_to === uid && !['completed','manager_approved'].includes(t.status)).slice(0, 6)
  }, [tasks, user?.id])

  const hour = new Date().getHours()
  const greetEmoji = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙'
  const greetWord = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.fullName?.split(' ')[0] || ''

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: '-0.7px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{greetEmoji}</span>
            {greetWord}{firstName ? `, ${firstName}` : ''}
          </div>
          <div style={{ color: 'var(--text2)', marginTop: 4, fontSize: 13 }}>
            {t('dashboard.subtitle')} &nbsp;·&nbsp;
            <span style={{ fontWeight: 800, color: overdue > 0 ? '#ef4444' : '#22c55e' }}>
              {overdue > 0 ? `⚠ ${overdue} overdue` : '✓ All caught up'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost btnSm" to="/app/my-tasks">My tasks</Link>
          <Link className="btn btnGhost btnSm" to="/app/board">Board</Link>
          <Link className="btn btnPrimary btnSm" to="/app/jeczone">{t('dashboard.jeczone')}</Link>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="kpiGrid">
        <KpiCardV2
          label="Total Tasks" value={total}
          icon={<IconTasks />} iconBg="rgba(99,102,241,0.12)" iconColor="#818cf8" accentColor="#818cf8"
          sub={`${completionPct}% completion rate`} pct={completionPct}
          onClick={() => setDetail({ title: 'Total Tasks', kind: 'kpi' })}
          loading={summary.isLoading}
        />
        <KpiCardV2
          label="In Progress" value={inProgress}
          icon={<IconProgress />} iconBg="rgba(244,202,87,0.12)" iconColor="#f4ca57" accentColor="#f4ca57"
          sub={`${total ? Math.round(inProgress/total*100) : 0}% of all tasks`}
          trend={inProgress > 0 ? `${inProgress} active` : undefined} trendUp={true}
          onClick={() => setDetail({ title: 'In Progress', kind: 'kpi', status: 'in_progress' })}
          loading={summary.isLoading}
        />
        <KpiCardV2
          label="Completed" value={done}
          icon={<IconDone />} iconBg="rgba(34,197,94,0.12)" iconColor="#22c55e" accentColor="#22c55e"
          sub={`Team score: ${score}`} pct={score}
          trend={done > 0 ? `${done} done` : undefined} trendUp={true}
          onClick={() => setDetail({ title: 'Completed', kind: 'kpi', status: 'completed' })}
          loading={summary.isLoading}
        />
        <KpiCardV2
          label="Overdue" value={overdue}
          icon={<IconOverdue />} iconBg={overdue > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)'} iconColor={overdue > 0 ? '#ef4444' : '#22c55e'} accentColor={overdue > 0 ? '#ef4444' : '#22c55e'}
          sub={overdue > 0 ? 'Needs immediate attention' : 'No overdue tasks 🎉'}
          trend={overdue > 0 ? `${overdue} tasks` : undefined} trendUp={false}
          onClick={() => setDetail({ title: 'Overdue Tasks', kind: 'kpi', status: 'overdue' })}
          loading={summary.isLoading}
        />
      </div>

      {/* ── Row 2: Status chart + Priority donut ── */}
      <div className="dashChartsGrid">
        <ChartCard
          title="Task Status Breakdown"
          subtitle="Distribution across all statuses"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
          badge={total > 0 ? { value: `${total} total`, neutral: true } : undefined}
        >
          <StatusBarChart byStatus={by} />
        </ChartCard>

        <ChartCard
          title="Priority Breakdown"
          subtitle="Tasks by urgency level"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
        >
          <PriorityPieChart byPriority={byPriority} />
        </ChartCard>
      </div>

      {/* ── Row 3: Deadlines trend (full width) ── */}
      <ChartCard
        title="Deadlines Trend — Last 7 Days"
        subtitle="Due vs overdue tasks over time"
        icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
        badge={deadlinePoints.length > 0 ? { value: 'Live', positive: true } : undefined}
      >
        <DeadlinesTrendChart points={deadlinePoints} />
      </ChartCard>

      {/* ── Row 4: Project progress + Team assignments ── */}
      <div className="dashChartsGrid">
        <ChartCard
          title="Project Progress"
          subtitle="Completion rate per project"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
        >
          <ProjectProgressChart rows={projectProgress} />
        </ChartCard>

        <ChartCard
          title="Team Assignments"
          subtitle="Work distribution per member"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
          badge={summary.data?.userCount ? { value: `${summary.data.userCount} members`, neutral: true } : undefined}
        >
          <AssignmentsChart rows={assignments} />
        </ChartCard>
      </div>

      {/* ── Row 5: Due today + My tasks + Workload ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

        {/* Due today */}
        <div className="chartCardV2">
          <div className="chartCardV2Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon" style={{ background: 'rgba(244,202,87,0.12)', color: '#f4ca57', borderColor: 'rgba(244,202,87,0.22)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <div className="chartCardV2Title">{t('dashboard.dueToday')}</div>
                <div className="chartCardV2Sub">{dueToday.length} task{dueToday.length !== 1 ? 's' : ''} due</div>
              </div>
            </div>
            <Link className="btn btnGhost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} to="/app/calendar">Calendar</Link>
          </div>
          <div className="chartCardV2Body">
            {dueToday.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Nothing due today</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {dueToday.slice(0, 5).map(task => (
                  <div key={task.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderLeft: `3px solid ${task.category_color?.trim() || '#f4ca57'}`,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || task.id}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{task.category_name || task.status}</div>
                    </div>
                    <span className={`statusBadge ${task.status === 'overdue' ? 'statusOverdue' : task.status === 'in_progress' ? 'statusInProgress' : 'statusPending'}`}>
                      {task.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
                {dueToday.length > 5 && (
                  <Link to="/app/tasks" style={{ textAlign: 'center', fontSize: 12, color: 'var(--primary)', fontWeight: 800, textDecoration: 'none', padding: '4px 0' }}>
                    +{dueToday.length - 5} more →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {/* My open tasks */}
        <div className="chartCardV2">
          <div className="chartCardV2Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>
              </div>
              <div>
                <div className="chartCardV2Title">{t('dashboard.myOpenTasks')}</div>
                <div className="chartCardV2Sub">{myOpenTasks.length} open</div>
              </div>
            </div>
            <Link className="btn btnGhost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} to="/app/my-tasks">View all</Link>
          </div>
          <div className="chartCardV2Body">
            {myOpenTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>All done!</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {myOpenTasks.map(task => (
                  <div key={task.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || task.id}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{task.category_name || '—'}</div>
                    </div>
                    <span className={`statusBadge ${task.status === 'overdue' ? 'statusOverdue' : task.status === 'in_progress' ? 'statusInProgress' : 'statusPending'}`}>
                      {task.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Team capacity */}
        <ChartCard
          title="Team Capacity"
          subtitle="Workload balance"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>}
          badge={summary.data?.userCount ? { value: `${summary.data.userCount} members`, neutral: true } : undefined}
        >
          <WorkloadBalanceChart
            workload={summary.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }}
            userCount={summary.data?.userCount ?? 0}
          />
        </ChartCard>
      </div>

      {/* ── Row 6: Performance leaderboard ── */}
      {(summary.data?.assigneeLeaderboard?.length ?? 0) > 0 && (
        <ChartCard
          title="Performance Leaderboard"
          subtitle="Score, active & completed tasks per team member"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
        >
          <AssigneeScoreChart rows={summary.data?.assigneeLeaderboard ?? []} />
        </ChartCard>
      )}

      {/* ── Error fallback ── */}
      {summary.isError && (
        <div className="card" style={{ borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontSize: 22 }}>⚠️</div>
            <div>
              <div style={{ fontWeight: 800 }}>Team summary unavailable</div>
              <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 3 }}>
                Your role may not include org-wide metrics. Charts show data from your assigned tasks.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      <Modal
        title={detail?.title || ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
        subtitle={detail?.status ? `Filtered by: ${detail.status}` : 'All tasks overview'}
        footer={
          <ModalFooterOpenTasks href="/app/tasks" onClose={() => setDetail(null)} />
        }
      >
        {detail?.kind === 'kpi' ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <KpiStrip total={total} inProgress={inProgress} completed={done} overdue={overdue} />
            {detail.status ? (
              <TaskSampleTable tasks={tasks.filter(t => t.status === detail.status)} />
            ) : (
              <>
                <StatusMiniChart byStatus={by} />
                <PriorityBreakdown byPriority={byPriority} />
                <AssignmentsBreakdownTable rows={assignments} />
                <ProjectsBreakdownTable rows={projectProgress} />
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <StatusBarChart byStatus={by} />
            <PriorityPieChart byPriority={byPriority} />
            <DeadlinesTrendChart points={deadlinePoints} />
          </div>
        )}
      </Modal>
    </div>
  )
}
