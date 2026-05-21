import { useMemo, useState } from 'react'
import { IconAward } from '../../components/ui/AppIcons'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canViewAnalytics } from '../../lib/rbac'
import { OnboardingBanner } from '../../components/OnboardingBanner'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { Modal } from '../../components/Modal'
import { useRealtimeInvalidation } from '../../lib/socket'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { KpiStrip } from '../../components/ui/KpiCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { AssignmentsChart } from '../../components/charts/WorkCharts'
import {
  DashboardHeroPanel,
  DashboardActivityChart,
  DashboardStatusChart,
  DashboardPriorityBars,
  DashboardVelocityChart,
  DashboardProjectProgressChart,
  DashboardTeamPerformanceChart,
  tasksToByStatus,
  CHART,
} from '../../components/charts/DashboardCharts'
import {
  ClipboardList, Zap, CheckCircle2, AlertTriangle, Send, FolderOpen, LayoutDashboard,
} from 'lucide-react'

type DashData = {
  tasks: {
    total: number; pending: number; in_progress: number; submitted: number
    completed: number; overdue: number; cancelled: number
    completion_rate: number; due_today: number; due_week: number
  }
  trend: Array<{ day: string; label: string; completed: number; overdue: number; created: number }>
  projects: Array<{
    id: string; name: string; color?: string | null; total: number
    completed: number; overdue: number; in_progress: number; pending: number; progress: number
  }>
  leaderboard: Array<{
    id: string; name: string; total: number; completed: number
    overdue: number; in_progress: number; completion_rate: number; score: number
  }>
  priority: Record<string, number>
  velocity: Array<{ week: string; week_start: string; created: number; completed: number }>
}

async function fetchDash(): Promise<DashData> {
  return apiFetch<DashData>('/api/v1/stats/dashboard')
}

export function DashboardHomePage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const canOpenChartDetails = canCreateTasksAndProjects(me?.role)
  const canOpenAdvancedDetails = canViewAnalytics(me?.role)
  const [createOpen, setCreateOpen] = useState(false)
  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })
  const [chartDetail, setChartDetail] = useState<null | 'activity' | 'status' | 'priority' | 'projects' | 'velocity' | 'team' | 'workload'>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDash,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  const tasks = data?.tasks
  const projects = useMemo(() => data?.projects || [], [data])
  const leaderboard = useMemo(() => data?.leaderboard || [], [data])
  const trendData = useMemo(() => (data?.trend || []).slice(-14), [data])
  const velocity = useMemo(() => {
    const raw = (data?.velocity || []).slice(-8)
    if (raw.length > 0) return raw.map(v => ({ ...v, label: v.week }))
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (7 - i) * 7)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { week: label, week_start: d.toISOString().slice(0, 10), created: 0, completed: 0, label }
    })
  }, [data])

  const byStatus = useMemo(() => tasksToByStatus(tasks), [tasks])
  const assignmentRows = useMemo(
    () => leaderboard.slice(0, 8).map(u => ({
      name: u.name,
      active: Math.max(0, u.total - u.completed - (u.overdue || 0)),
      overdue: u.overdue || 0,
      done: u.completed,
    })),
    [leaderboard],
  )

  const detailBtn = (key: typeof chartDetail) =>
    canOpenChartDetails ? (
      <button type="button" className="btn btnGhost btnCompact" onClick={() => setChartDetail(key)}>Details</button>
    ) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeaderCard
        icon={<LayoutDashboard size={20} strokeWidth={2} />}
        title="Dashboard"
        subtitle={`Real-time analytics · ${tasks?.total || 0} tasks across ${projects.length} projects · Auto-refreshes every 30s`}
        badges={[
          { label: 'Live data', color: CHART.green, icon: '●' },
          ...(tasks?.overdue ? [{ label: `${tasks.overdue} overdue`, color: CHART.red, icon: '⚠' }] : []),
          ...(tasks?.completion_rate !== undefined ? [{ label: `${tasks.completion_rate}% complete`, color: CHART.green, icon: '✓' }] : []),
        ]}
      />

      <OnboardingBanner />

      <KpiStrip
        loading={isLoading}
        skeletonCount={6}
        items={[
          { label: 'Total Tasks', value: tasks?.total || 0, color: CHART.brand, icon: <ClipboardList size={36} />, sub: `${tasks?.due_today || 0} due today` },
          { label: 'In Progress', value: tasks?.in_progress || 0, color: CHART.purple, icon: <Zap size={36} />, sub: 'active work' },
          { label: 'Completed', value: tasks?.completed || 0, color: CHART.green, icon: <CheckCircle2 size={36} />, sub: `${tasks?.completion_rate || 0}% rate` },
          { label: 'Overdue', value: tasks?.overdue || 0, color: CHART.red, icon: <AlertTriangle size={36} />, sub: `${tasks?.due_week || 0} due this week` },
          { label: 'Pending Review', value: tasks?.submitted || 0, color: CHART.blue, icon: <Send size={36} />, sub: 'awaiting approval' },
          { label: 'Projects', value: projects.length, color: CHART.teal, icon: <FolderOpen size={36} />, sub: `${projects.filter(p => p.progress === 100).length} complete` },
        ]}
      />

      <section className="dashChartsSection" aria-label="Dashboard charts">
        <div className="dashChartsHero">
          <DashboardHeroPanel
            loading={isLoading}
            trend={trendData}
            tasks={tasks}
            priority={data?.priority}
          />
        </div>

        <div className="dashChartsPriority">
          <ChartCard
            title="Task Status"
            subtitle="Lifecycle distribution"
            loading={isLoading}
            right={detailBtn('status')}
            icon={<CheckCircle2 size={18} />}
          >
            <DashboardStatusChart byStatus={byStatus} loading={isLoading} />
          </ChartCard>

          <ChartCard
            title="Priority Breakdown"
            subtitle="Tasks by urgency"
            loading={isLoading}
            right={detailBtn('priority')}
            icon={<AlertTriangle size={18} />}
          >
            <DashboardPriorityBars priority={data?.priority || {}} />
          </ChartCard>

          <ChartCard
            title="Weekly Velocity"
            subtitle="Created vs completed per week"
            loading={isLoading}
            right={detailBtn('velocity')}
            icon={<Zap size={18} />}
          >
            <DashboardVelocityChart data={velocity} loading={isLoading} />
          </ChartCard>
        </div>

        <div className="dashChartsFull">
          <ChartCard
            title="Project Progress"
            subtitle="Completion % per active project"
            loading={isLoading}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {detailBtn('projects')}
                <Link to="/app/projects" style={{ fontSize: 11, color: CHART.brand, fontWeight: 800, textDecoration: 'none' }}>All →</Link>
              </div>
            }
            icon={<FolderOpen size={18} />}
          >
            <DashboardProjectProgressChart projects={projects} />
          </ChartCard>
        </div>

        <div className="dashChartsRow2">
          <ChartCard
            title="Team Performance"
            subtitle="Completion rate by assignee"
            loading={isLoading}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {detailBtn('team')}
                <Link to="/app/analytics" style={{ fontSize: 11, color: CHART.brand, fontWeight: 800, textDecoration: 'none' }}>Analytics →</Link>
              </div>
            }
          >
            <DashboardTeamPerformanceChart rows={leaderboard} />
          </ChartCard>

          <ChartCard title="At-Risk Tasks" subtitle="Overdue items needing attention">
            <AtRiskList />
          </ChartCard>
        </div>

        <div className="dashChartsFull">
          <ChartCard
            title="Team Workload"
            subtitle="Done · Active · Overdue per person"
            loading={isLoading}
            right={detailBtn('workload')}
            fillHeight
          >
            <AssignmentsChart rows={assignmentRows} loading={isLoading} />
          </ChartCard>
        </div>
      </section>

      <Modal
        title={
          chartDetail === 'activity' ? 'Task Activity Details'
            : chartDetail === 'status' ? 'Task Status Details'
            : chartDetail === 'priority' ? 'Priority Breakdown Details'
            : chartDetail === 'projects' ? 'Project Progress Details'
            : chartDetail === 'velocity' ? 'Weekly Velocity Details'
            : chartDetail === 'team' ? 'Team Performance Details'
            : chartDetail === 'workload' ? 'Team Workload Details'
            : 'Chart details'
        }
        open={!!chartDetail}
        wide
        onClose={() => setChartDetail(null)}
        footer={<button type="button" className="btn btnPrimary" style={{ height: 38 }} onClick={() => setChartDetail(null)}>Close</button>}
      >
        {!canOpenAdvancedDetails ? (
          <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
            Detailed metrics are limited for your role. You can still use the dashboard cards for high-level status and trends.
          </div>
        ) : null}
        {chartDetail === 'activity' ? <DashboardActivityChart data={trendData} /> : null}
        {chartDetail === 'status' && tasks ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(byStatus).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
                <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                <div>{Math.round((v / Math.max(1, tasks.total)) * 100)}%</div>
                <div style={{ fontWeight: 900 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'priority' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(data?.priority || {}).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{k}</div>
                <div style={{ fontWeight: 900 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'projects' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {projects.slice(0, 12).map(p => (
              <div key={p.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr repeat(4, 1fr)', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div>Done: {p.completed}</div>
                <div>Active: {p.in_progress}</div>
                <div>Overdue: {p.overdue}</div>
                <div style={{ fontWeight: 900 }}>{p.progress}%</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'velocity' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {velocity.map(v => (
              <div key={v.week} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{v.week}</div>
                <div>Created: {v.created}</div>
                <div>Done: {v.completed}</div>
                <div style={{ fontWeight: 900, color: v.completed - v.created >= 0 ? CHART.green : CHART.red }}>
                  {v.completed - v.created >= 0 ? '+' : ''}{v.completed - v.created}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'team' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {leaderboard.slice(0, 12).map(u => (
              <div key={u.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{u.name}</div>
                <div>Rate: {u.completion_rate}%</div>
                <div>Done: {u.completed}/{u.total}</div>
                <div style={{ fontWeight: 900 }}>Score {u.score}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'workload' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {leaderboard.slice(0, 12).map(u => {
              const active = Math.max(0, u.total - u.completed - (u.overdue || 0))
              return (
                <div key={u.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{u.name}</div>
                  <div>Done {u.completed}</div>
                  <div>Active {active}</div>
                  <div style={{ color: (u.overdue || 0) > 0 ? CHART.red : 'var(--text)' }}>Overdue {u.overdue || 0}</div>
                </div>
              )
            })}
          </div>
        ) : null}
      </Modal>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

type RTask = { id: string; title: string; status: string; priority?: string | null; due_date?: string | null; assigned_to_name?: string | null; category_name?: string | null }

function AtRiskList() {
  const { data } = useQuery({
    queryKey: ['dash-overdue'],
    queryFn: () => apiFetch<{ tasks?: RTask[] }>('/api/v1/tasks?limit=20&page=1&status=overdue').then(d => d.tasks || []),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  const tasks = data || []
  if (!tasks.length) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}><IconAward size={14} /></div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>All tasks on track!</div>
        <div style={{ fontSize: 11, marginTop: 3 }}>No overdue items.</div>
      </div>
    )
  }
  const pCol: Record<string, string> = { critical: CHART.red, high: CHART.orange, medium: CHART.purple, low: CHART.blue }
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {tasks.slice(0, 8).map(t => {
        const numeric = Number(t.due_date)
        const due = t.due_date
          ? (!isNaN(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(t.due_date))
          : null
        const daysOverdue = (due && !isNaN(due.getTime()) && due.getFullYear() >= 2020 && due.getFullYear() <= 2040)
          ? Math.floor((Date.now() - due.getTime()) / 86400000)
          : null
        return (
          <div key={t.id} style={{ padding: '9px 12px', borderRadius: 11, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{t.assigned_to_name || '—'}{t.category_name ? ` · ${t.category_name}` : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
              {daysOverdue !== null && <span style={{ fontSize: 10, fontWeight: 900, color: CHART.red }}>{daysOverdue}d late</span>}
              {t.priority && <span style={{ fontSize: 9, fontWeight: 800, color: pCol[t.priority] || 'var(--muted)', textTransform: 'capitalize' }}>{t.priority}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
