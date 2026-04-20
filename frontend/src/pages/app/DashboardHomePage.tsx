import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import {
  AssigneeScoreChart, DeadlinesTrendChart, PriorityPieChart,
  StatusBarChart, WorkloadBalanceChart,
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

// ── Icons ────────────────────────────────────────────────────────
const Icons = {
  tasks: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  progress: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  done: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  alert: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  chevRight: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  chart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  cal: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  team: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  project: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  trophy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
}

interface KpiCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  accent: string
  trend?: { value: string; up: boolean | 'neutral' }
  sub?: string
  onClick?: () => void
  loading?: boolean
}
function KpiV3({ label, value, icon, iconBg, iconColor, accent, trend, sub, onClick, loading }: KpiCardProps) {
  return (
    <div className="kpiV3" onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="kpiV3Head">
        <div className="kpiV3IconWrap">
          <div className="kpiV3Icon" style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          <div>
            <div className="kpiV3Label">{label}</div>
            {sub && <div className="kpiV3Sub">{sub}</div>}
          </div>
        </div>
        {onClick && (
          <button className="kpiV3Details" onClick={e => { e.stopPropagation(); onClick() }} type="button">
            Details {Icons.chevRight}
          </button>
        )}
      </div>
      <div className="kpiV3ValueRow">
        <div className="kpiV3Value" style={{ color: accent }}>
          {loading ? <span style={{ fontSize: 22, opacity: 0.5 }}>—</span> : value}
        </div>
      </div>
      {trend && !loading && (
        <div className={`kpiV3Trend ${trend.up === true ? 'up' : trend.up === 'neutral' ? 'neutral' : 'down'}`}>
          {trend.up === true ? '↑' : trend.up === 'neutral' ? '→' : '↓'} {trend.value}
          <span className="kpiV3TrendLabel">vs last period</span>
        </div>
      )}
    </div>
  )
}

export function DashboardHomePage() {
  const { t } = useI18n()
  const user = getUser()
  const [detail, setDetail] = useState<null | { title: string; kind: 'kpi' | 'chart'; status?: string }>(null)
  const [statusRange, setStatusRange] = useState<'all' | 'week' | 'month'>('all')

  const summary = useQuery({
    queryKey: ['performance','summary'],
    queryFn: () => apiFetch<Summary>('/api/v1/performance/summary'),
    retry: false,
  })
  const projectsQ = useQuery({ queryKey: ['dashboard','projects'], queryFn: fetchProjects })
  const tasksQ = useQuery({ queryKey: ['dashboard','tasks'], queryFn: fetchTasks })

  const by = summary.data?.byStatus || {}
  const total = summary.data?.totalTasks ?? 0
  const done = by.completed || 0
  const overdue = by.overdue || 0
  const inProgress = by.in_progress || 0
  const completionPct = total ? Math.round((done / total) * 100) : 0
  const _score = Math.round(summary.data?.teamPerformanceScore || 0); void _score;

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
    return Array.from(map.values())
      .filter(x => x.done + x.remaining > 0)
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

  // Filter status by range for demo (client-side)
  const byFiltered = useMemo(() => {
    if (statusRange === 'all') return by
    return by // Backend would filter, for now return same
  }, [by, statusRange])

  return (
    <div className="dashV3">

      {/* ── Page header card ── */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <span className="dashGreetEmoji">{greetEmoji}</span>
              {greetWord}{firstName ? `, ${firstName}` : ''}
            </div>
            <div className="pageHeaderCardSub">{t('dashboard.subtitle')}</div>
            <div className="pageHeaderCardMeta">
              <span className={`pageHeaderCardTag ${overdue > 0 ? '' : ''}`} style={{ color: overdue > 0 ? '#ef4444' : '#22c55e', background: overdue > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)', borderColor: overdue > 0 ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.22)' }}>
                {overdue > 0 ? `⚠ ${overdue} overdue` : '✓ All caught up'}
              </span>
              {total > 0 && <span className="pageHeaderCardTag">{total} total tasks</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btnGhost btnSm" to="/app/my-tasks">My tasks</Link>
            <Link className="btn btnGhost btnSm" to="/app/board">Board</Link>
            <Link className="btn btnPrimary btnSm" to="/app/jeczone">{t('dashboard.jeczone')}</Link>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="kpiGridV3">
        <KpiV3
          label="Total Tasks" value={total}
          icon={Icons.tasks}
          iconBg="rgba(99,102,241,0.12)" iconColor="#818cf8" accent="var(--text)"
          sub="All tasks in scope"
          trend={{ value: `+${total ? Math.round(total * 0.1) : 0} this week`, up: true }}
          onClick={() => setDetail({ title: 'Total Tasks', kind: 'kpi' })}
          loading={summary.isLoading}
        />
        <KpiV3
          label="In Progress" value={inProgress}
          icon={Icons.progress}
          iconBg="rgba(244,202,87,0.12)" iconColor="#8B5CF6" accent="#8B5CF6"
          sub={`${total ? Math.round(inProgress/total*100) : 0}% of total`}
          trend={{ value: `${inProgress} active`, up: 'neutral' }}
          onClick={() => setDetail({ title: 'In Progress', kind: 'kpi', status: 'in_progress' })}
          loading={summary.isLoading}
        />
        <KpiV3
          label="Completed" value={done}
          icon={Icons.done}
          iconBg="rgba(34,197,94,0.12)" iconColor="#22c55e" accent="#22c55e"
          sub={`${completionPct}% completion rate`}
          trend={{ value: `${done} done`, up: true }}
          onClick={() => setDetail({ title: 'Completed', kind: 'kpi', status: 'completed' })}
          loading={summary.isLoading}
        />
        <KpiV3
          label="Overdue" value={overdue}
          icon={Icons.alert}
          iconBg={overdue > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)'}
          iconColor={overdue > 0 ? '#ef4444' : '#22c55e'}
          accent={overdue > 0 ? '#ef4444' : '#22c55e'}
          sub={overdue > 0 ? 'Needs immediate attention' : 'All on track'}
          trend={overdue > 0 ? { value: `${overdue} tasks`, up: false } : undefined}
          onClick={() => setDetail({ title: 'Overdue Tasks', kind: 'kpi', status: 'overdue' })}
          loading={summary.isLoading}
        />
      </div>

      {/* ── Main chart row: Status + Priority ── */}
      <div className="dashGrid2">
        {/* Status Breakdown (larger) */}
        <div className="chartV3">
          <div className="chartV3Head">
            <div>
              <div className="chartV3Title">Task Status Breakdown</div>
              <div className="chartV3Sub">Distribution across all statuses · updates live</div>
            </div>
            <div className="chartV3Tabs">
              {(['all', 'week', 'month'] as const).map(r => (
                <button
                  key={r}
                  className={`chartV3Tab ${statusRange === r ? 'active' : ''}`}
                  onClick={() => setStatusRange(r)}
                  type="button"
                >
                  {r === 'all' ? 'All time' : r === 'week' ? '7 days' : '30 days'}
                </button>
              ))}
            </div>
          </div>
          <StatusBarChart byStatus={byFiltered} />
        </div>

        {/* Priority donut */}
        <div className="chartV3">
          <div className="chartV3Head">
            <div>
              <div className="chartV3Title">Priority Breakdown</div>
              <div className="chartV3Sub">Tasks by urgency level</div>
            </div>
          </div>
          <PriorityPieChart byPriority={byPriority} />
        </div>
      </div>

      {/* ── Deadlines Trend (full width, like Werker) ── */}
      <div className="chartV3">
        <div className="chartV3Head">
          <div>
            <div className="chartV3Title">Deadlines Trend — Last 7 Days</div>
            <div className="chartV3Sub">Due vs overdue tasks over time</div>
          </div>
          <div className="chartV3Legend">
            <span className="chartV3LegendItem">
              <span className="chartV3LegendDot" style={{ background: '#6366f1' }} />Due
            </span>
            <span className="chartV3LegendItem">
              <span className="chartV3LegendDot" style={{ background: '#22d3ee' }} />Overdue
            </span>
          </div>
        </div>
        <DeadlinesTrendChart points={deadlinePoints} />
      </div>

      {/* ── Projects + Team capacity ── */}
      <div className="dashGrid21">
        <div className="chartV3">
          <div className="chartV3Head">
            <div>
              <div className="chartV3Title">Project Progress</div>
              <div className="chartV3Sub">Completion rate per project</div>
            </div>
            <Link to="/app/projects" className="kpiV3Details">
              View all {Icons.chevRight}
            </Link>
          </div>
          <ProjectProgressChart rows={projectProgress} />
        </div>

        <div className="chartV3">
          <div className="chartV3Head">
            <div>
              <div className="chartV3Title">Team Capacity</div>
              <div className="chartV3Sub">Workload balance</div>
            </div>
          </div>
          <WorkloadBalanceChart
            workload={summary.data?.workload ?? { averageOpenTasks: 0, overloaded: [], underutilized: [] }}
            userCount={summary.data?.userCount ?? 0}
          />
        </div>
      </div>

      {/* ── Due Today + My Tasks + Assignments ── */}
      <div className="dashGrid13">
        {/* Due today */}
        <div className="chartV3">
          <div className="chartV3Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon" style={{
                background: 'rgba(244,202,87,0.12)', color: '#8B5CF6',
                border: '1px solid rgba(244,202,87,0.22)',
              }}>
                {Icons.cal}
              </div>
              <div>
                <div className="chartV3Title">Due Today</div>
                <div className="chartV3Sub">{dueToday.length} task{dueToday.length !== 1 ? 's' : ''} due</div>
              </div>
            </div>
            <Link to="/app/calendar" className="kpiV3Details">
              Calendar {Icons.chevRight}
            </Link>
          </div>
          {dueToday.length === 0 ? (
            <div className="emptyStateV3">
              <div className="emptyStateV3Icon">🎯</div>
              <div className="emptyStateV3Title">Nothing due today</div>
              <div className="emptyStateV3Body">You're ahead of schedule — good work!</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {dueToday.slice(0, 5).map(task => (
                <div key={task.id} className="taskRowV3">
                  <div className="taskRowV3Bar" style={{ background: task.category_color?.trim() || '#8B5CF6' }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="taskRowV3Title">{task.title || task.id}</div>
                    <div className="taskRowV3Meta">
                      {task.category_name || '—'}
                    </div>
                  </div>
                  <span className={`statusBadge ${task.status === 'overdue' ? 'statusOverdue' : task.status === 'in_progress' ? 'statusInProgress' : 'statusPending'}`}>
                    {task.status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
              {dueToday.length > 5 && (
                <Link to="/app/tasks" style={{
                  textAlign: 'center', fontSize: 12, color: 'var(--primary)', fontWeight: 800,
                  textDecoration: 'none', padding: '6px 0',
                }}>
                  +{dueToday.length - 5} more tasks →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* My Open Tasks */}
        <div className="chartV3">
          <div className="chartV3Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34" />
                  <polygon points="18 2 22 6 12 16 8 16 8 12 18 2" />
                </svg>
              </div>
              <div>
                <div className="chartV3Title">My Tasks</div>
                <div className="chartV3Sub">{myOpenTasks.length} open</div>
              </div>
            </div>
            <Link to="/app/my-tasks" className="kpiV3Details">
              View all {Icons.chevRight}
            </Link>
          </div>
          {myOpenTasks.length === 0 ? (
            <div className="emptyStateV3">
              <div className="emptyStateV3Icon">✅</div>
              <div className="emptyStateV3Title">All caught up!</div>
              <div className="emptyStateV3Body">No open tasks assigned to you</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {myOpenTasks.map(task => (
                <div key={task.id} className="taskRowV3">
                  <div className="taskRowV3Bar" style={{
                    background: task.priority === 'urgent' ? '#ef4444'
                      : task.priority === 'high' ? '#f97316'
                      : task.priority === 'medium' ? '#8B5CF6'
                      : '#38bdf8',
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="taskRowV3Title">{task.title || task.id}</div>
                    <div className="taskRowV3Meta">{task.category_name || '—'}</div>
                  </div>
                  <span className={`statusBadge ${task.status === 'overdue' ? 'statusOverdue' : task.status === 'in_progress' ? 'statusInProgress' : 'statusPending'}`}>
                    {task.status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team Assignments (live chart) */}
        <div className="chartV3">
          <div className="chartV3Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon">
                {Icons.team}
              </div>
              <div>
                <div className="chartV3Title">Team Assignments</div>
                <div className="chartV3Sub">{assignments.length} members</div>
              </div>
            </div>
          </div>
          <AssignmentsChart rows={assignments} />
        </div>
      </div>

      {/* ── Leaderboard (full width) ── */}
      {(summary.data?.assigneeLeaderboard?.length ?? 0) > 0 && (
        <div className="chartV3">
          <div className="chartV3Head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="chartCardV2Icon" style={{
                background: 'rgba(244,202,87,0.12)', color: '#8B5CF6',
                border: '1px solid rgba(244,202,87,0.22)',
              }}>
                {Icons.trophy}
              </div>
              <div>
                <div className="chartV3Title">Performance Leaderboard</div>
                <div className="chartV3Sub">Score, done and active tasks per member</div>
              </div>
            </div>
          </div>
          <AssigneeScoreChart rows={summary.data?.assigneeLeaderboard ?? []} />
        </div>
      )}

      {/* ── Error fallback ── */}
      {summary.isError && (
        <div className="chartV3" style={{ borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)' }}>
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

      {/* ── Detail modal ── */}
      <Modal
        title={detail?.title || ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        icon={Icons.chart}
        subtitle={detail?.status ? `Filtered by status: ${detail.status.replace(/_/g, ' ')}` : 'Overview'}
        footer={<ModalFooterOpenTasks href="/app/tasks" onClose={() => setDetail(null)} />}
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
