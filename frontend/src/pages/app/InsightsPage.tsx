import { useQuery } from '@tanstack/react-query'
import {
  IconAlertTriangle, IconAward, IconBarChart, IconCheckCircle,
  IconClipboard, IconCritical, IconFlag, IconLightning,
  IconOverdue, IconRisk, IconUsers, IconTarget, IconWorkload,
  IconRobot,
} from '../../components/ui/AppIcons'
import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { apiFetch } from '../../lib/api'
import { useRealtimeInvalidation } from '../../lib/socket'
import { Select } from '../../components/ui/Select'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
  ComposedChart, Area, Line,
} from 'recharts'

/* ─── Types ────────────────────────────────────────────────────────────────── */
type TaskRow     = { status: string; priority?: string; assigned_to_name?: string | null; due_date?: string | null; category_name?: string | null }
type WorkloadRow = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }

/* ─── Constants ────────────────────────────────────────────────────────────── */
const RANGE_OPTS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8', in_progress: '#8b5cf6', submitted: '#38bdf8',
  ai_reviewing: '#06b6d4', ai_approved: '#10b981', ai_rejected: '#f97316',
  manager_approved: '#22c55e', completed: '#22c55e', overdue: '#ef4444', cancelled: '#6b7280',
}
const PRIORITY_COLORS: Record<string, string> = {
  low: '#38bdf8', medium: '#8b5cf6', high: '#f97316', critical: '#ef4444', urgent: '#dc2626',
}

/* ─── Hook: container width (ResizeObserver) ────────────────────────────────
   Professional approach: measure the actual content column width, not the
   viewport. This means charts adapt to the sidebar being open/collapsed too. */
function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width))
    })
    ro.observe(ref.current)
    setWidth(ref.current.offsetWidth)
    return () => ro.disconnect()
  }, [])
  return width
}

/* Derived layout tokens from container width — single source of truth */
function useLayout(w: number) {
  const isMobile  = w > 0 && w < 480
  const isTablet  = w >= 480 && w < 768
  const isDesktop = w >= 768

  // Chart heights scale with available width
  const chartH  = isMobile ? 180 : isTablet ? 200 : 220
  const trendH  = isMobile ? 180 : isTablet ? 210 : 240
  const radarH  = isMobile ? 180 : 200

  // KPI columns: 2 on mobile, 3 on tablet, 5 on desktop
  const kpiCols = isMobile ? 2 : isTablet ? 3 : 5

  // Trend+donut: stacked on mobile/tablet, side-by-side on desktop (2fr+1fr)
  const row1Cols = isDesktop ? 'minmax(0,2fr) minmax(0,1fr)' : '1fr'

  // Chart grid: 1 col → 2 col
  const row2Cols = isMobile ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))'

  // Workload tiles: 1 col → 2 col → 3 col
  const workloadCols = isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3,1fr)'

  // Donut radii shrink on narrow screens
  const donutOuter = isMobile ? 60 : 72
  const donutInner = isMobile ? 32 : 40

  // Y-axis label width for horizontal bar charts
  const yAxisW = isMobile ? 56 : 72

  // Left margin for charts (negative to recover axis space)
  const leftMargin = isMobile ? -28 : -22

  return { isMobile, isTablet, isDesktop, chartH, trendH, radarH, kpiCols, row1Cols, row2Cols, workloadCols, donutOuter, donutInner, yAxisW, leftMargin }
}

/* ─── Sub-components ────────────────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="insightsTooltip">
      {label && <div className="insightsTooltipLabel">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="insightsTooltipRow">
          <span style={{ color: p.fill || p.color || '#fff', fontWeight: 700 }}>{p.name}</span>
          <span style={{ color: '#fff', fontWeight: 900 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'var(--brand)', icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: ReactNode
}) {
  return (
    <div className="insightsKpiCard" style={{ '--kpi-color': color } as React.CSSProperties}>
      {icon && <div className="insightsKpiIcon">{icon}</div>}
      <div className="insightsKpiLabel">{label}</div>
      <div className="insightsKpiValue">{value}</div>
      {sub && <div className="insightsKpiSub">{sub}</div>}
    </div>
  )
}

function ChartCard({ title, icon, children }: { title: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="card insightsChartCard">
      <div className="insightsChartTitle">
        {icon && <span className="insightsChartIcon">{icon}</span>}
        {title}
      </div>
      <div className="insightsChartBody">{children}</div>
    </div>
  )
}

function InsightCard({ icon, title, body, tone = 'neutral' }: {
  icon: ReactNode; title: string; body: string; tone?: 'positive' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className={`insightsInsightCard insightsInsightCard--${tone}`}>
      <span className="insightsInsightIcon">{icon}</span>
      <div>
        <div className="insightsInsightTitle">{title}</div>
        <div className="insightsInsightBody">{body}</div>
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="insightsLegendItem">
      <span style={{ background: color }} className="insightsLegendDot" />
      {label}
    </span>
  )
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export function InsightsPage() {
  const [days, setDays] = useState('30d')
  const dayNum = parseInt(days) || 30
  useRealtimeInvalidation({ tasks: true, employees: true })

  /* Measure the page content column — drives all layout decisions */
  const pageRef = useRef<HTMLDivElement>(null)
  const containerW = useContainerWidth(pageRef)
  const L = useLayout(containerW)

  /* Queries */
  const tasksQ = useQuery({
    queryKey: ['insights-tasks', days],
    queryFn: () => apiFetch<{ tasks: TaskRow[] }>('/api/v1/tasks?limit=500&page=1').then(d => d.tasks || []),
    staleTime: 60_000, refetchInterval: 60_000,
  })
  const workloadQ = useQuery({
    queryKey: ['insights-workload', dayNum],
    queryFn: () => apiFetch<{ employees: WorkloadRow[] }>(`/api/v1/analytics/workload?days=${dayNum}`).then(d => d.employees || []),
    staleTime: 60_000, refetchInterval: 60_000,
  })
  const analyticsQ = useQuery({
    queryKey: ['insights-analytics', dayNum],
    queryFn: () => apiFetch<{ points?: Array<{ day: string; completed: number; created: number; overdue: number }> }>(`/api/v1/analytics/tasks-over-time?days=${dayNum}`).catch(() => ({ points: [] })),
    staleTime: 60_000, refetchInterval: 60_000,
  })

  /* Derived data */
  const stats = useMemo(() => {
    const tasks = tasksQ.data || []
    if (!tasks.length) return null
    const count = (fn: (t: TaskRow) => boolean) => tasks.filter(fn).length
    const total      = tasks.length
    const completed  = count(t => t.status === 'completed')
    const overdue    = count(t => t.status === 'overdue')
    const inProgress = count(t => t.status === 'in_progress')
    const pending    = count(t => t.status === 'pending')
    const submitted  = count(t => t.status === 'submitted')
    const completionRate = total ? Math.round((completed / total) * 100) : 0
    const overdueRate    = total ? Math.round((overdue  / total) * 100) : 0
    const byCritical = count(t => t.priority === 'critical')
    const byHigh     = count(t => t.priority === 'high')
    const byMedium   = count(t => t.priority === 'medium')
    const byLow      = count(t => t.priority === 'low')
    const byUrgent   = count(t => t.priority === 'urgent')

    const assigneeCounts: Record<string, number> = {}
    for (const t of tasks) {
      if (t.assigned_to_name && ['pending','in_progress','overdue'].includes(t.status))
        assigneeCounts[t.assigned_to_name] = (assigneeCounts[t.assigned_to_name] || 0) + 1
    }
    const topAssignees = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

    const catCounts: Record<string, number> = {}
    for (const t of tasks)
      if (t.category_name) catCounts[t.category_name] = (catCounts[t.category_name] || 0) + 1
    const topCategories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)

    const statusCounts: Record<string, number> = {}
    for (const t of tasks) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
    const statusPie = Object.entries(statusCounts)
      .map(([name, value]) => ({ name: name.replace(/_/g, ' '), value, status: name, fill: STATUS_COLORS[name] || '#94a3b8' }))
      .filter(d => d.value > 0).sort((a, b) => b.value - a.value)

    return { total, completed, overdue, inProgress, pending, submitted, completionRate, overdueRate, byCritical, byHigh, byMedium, byLow, byUrgent, topAssignees, topCategories, statusPie }
  }, [tasksQ.data])

  const workload         = workloadQ.data || []
  const avgOpenTasks     = workload.length ? (workload.reduce((s, w) => s + w.open_tasks, 0) / workload.length).toFixed(1) : '—'
  const overloadedPeople = workload.filter(w => w.open_tasks > 10)

  const trendPoints = useMemo(() => {
    const raw = (analyticsQ.data as any)?.points || []
    return raw.map((p: any) => ({
      day: String(p.day || '').slice(5),
      completed: p.completed || 0,
      created:   p.created   || 0,
      overdue:   p.overdue   || 0,
    }))
  }, [analyticsQ.data])

  const priorityBars = stats ? [
    { name: 'Urgent',   value: stats.byUrgent,   fill: PRIORITY_COLORS.urgent   },
    { name: 'Critical', value: stats.byCritical,  fill: PRIORITY_COLORS.critical },
    { name: 'High',     value: stats.byHigh,      fill: PRIORITY_COLORS.high     },
    { name: 'Medium',   value: stats.byMedium,    fill: PRIORITY_COLORS.medium   },
    { name: 'Low',      value: stats.byLow,       fill: PRIORITY_COLORS.low      },
  ].filter(d => d.value > 0) : []

  const workloadBars = workload.slice(0, L.isMobile ? 6 : 8).map(w => ({
    name: w.employee_name.split(' ')[0],
    open: w.open_tasks,
    done: Math.max(0, w.total_tasks - w.open_tasks),
  }))

  const insights = useMemo(() => {
    if (!stats) return []
    const items: { icon: ReactNode; title: string; body: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }[] = []
    if      (stats.completionRate >= 80) items.push({ icon: <IconAward size={14} />,         title: 'Strong completion rate',          body: `${stats.completionRate}% of tasks completed — your team is executing well.`,                         tone: 'positive' })
    else if (stats.completionRate  < 50) items.push({ icon: <IconAlertTriangle size={14} />, title: 'Low completion rate',             body: `Only ${stats.completionRate}% completed. Review workloads and deadlines.`,                            tone: 'warning'  })
    if      (stats.overdueRate    > 20)  items.push({ icon: <IconRisk size={14} />,          title: 'High overdue rate',               body: `${stats.overdue} tasks (${stats.overdueRate}%) overdue. Reassign or extend deadlines.`,               tone: 'danger'   })
    else if (stats.overdue        === 0) items.push({ icon: <IconCheckCircle size={14} />,   title: 'No overdue tasks',                body: 'All tasks within deadline — great scheduling discipline!',                                            tone: 'positive' })
    if      (stats.byCritical      > 0)  items.push({ icon: <IconCritical size={14} />,      title: `${stats.byCritical} critical tasks`, body: 'Ensure these have active owners and are unblocked.',                                            tone: 'danger'   })
    if (overloadedPeople.length    > 0)  items.push({ icon: <IconUsers size={14} />,         title: `${overloadedPeople.length} overloaded`, body: `${overloadedPeople.map(p => p.employee_name).join(', ')} each have 10+ open tasks.`,          tone: 'warning'  })
    if      (stats.submitted       > 0)  items.push({ icon: <IconClipboard size={14} />,     title: `${stats.submitted} awaiting review`,  body: 'Review them to unblock your team.',                                                             tone: 'neutral'  })
    if (stats.pending > stats.inProgress * 2) items.push({ icon: <IconFlag size={14} />,    title: 'Many tasks not started',          body: `${stats.pending} pending vs ${stats.inProgress} in progress. Triage the backlog.`,                    tone: 'warning'  })
    if (!items.length)                   items.push({ icon: <IconBarChart size={14} />,      title: 'Operations look healthy',         body: 'No significant issues detected.',                                                                     tone: 'positive' })
    return items
  }, [stats, overloadedPeople])

  const loading = tasksQ.isLoading || workloadQ.isLoading

  /* Shared Recharts axis props */
  const xTick = { fill: 'var(--muted)', fontSize: L.isMobile ? 9 : 10, fontWeight: 700 as const }
  const yTick = { fill: 'var(--muted)', fontSize: L.isMobile ? 9 : 10 }

  return (
    <div className="insightsPage" ref={pageRef}>

      {/* ── Header ── */}
      <div className="pageHeaderCard">
        <div className="insightsHeader">
          <div>
            <div className="pageHeaderCardTitle">Insights</div>
            <div className="pageHeaderCardSub">Real-time performance analysis from your live task data</div>
          </div>
          <div className="insightsRangeSelect">
            <Select value={days} onChange={setDays} options={RANGE_OPTS} />
          </div>
        </div>
      </div>

      {/* ── Loading skeletons ── */}
      {loading && (
        <div className="insightsKpiStrip" style={{ '--kpi-cols': String(L.kpiCols) } as React.CSSProperties}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton insightsKpiSkeleton" />
          ))}
        </div>
      )}

      {/* ── Main content ── */}
      {!loading && stats && (
        <>
          {/* KPI strip */}
          <div className="insightsKpiStrip" style={{ '--kpi-cols': String(L.kpiCols) } as React.CSSProperties}>
            <StatCard label="Total Tasks"       value={stats.total}       sub="in your org"              color="#e2ab41" icon={<IconClipboard  size={14} />} />
            <StatCard label="Completed"         value={stats.completed}   sub={`${stats.completionRate}% rate`}  color="#22c55e" icon={<IconCheckCircle size={14} />} />
            <StatCard label="In Progress"       value={stats.inProgress}  sub="active right now"         color="#8b5cf6" icon={<IconLightning  size={14} />} />
            <StatCard label="Overdue"           value={stats.overdue}     sub={`${stats.overdueRate}% of total`} color={stats.overdue > 0 ? '#ef4444' : '#22c55e'} icon={<IconOverdue size={14} />} />
            <StatCard label="Avg Open / Person" value={avgOpenTasks}      sub="workload balance"         color="#f59e0b" icon={<IconUsers      size={14} />} />
          </div>

          {/* ── Row 1: Trend area chart + Status donut ── */}
          <div className="insightsRow1" style={{ '--row1-cols': L.row1Cols } as React.CSSProperties}>
            <ChartCard title="Activity Trend" icon={<IconBarChart size={14} />}>
              {trendPoints.length < 2
                ? <div className="insightsEmpty">Collecting trend data…</div>
                : <ResponsiveContainer width="100%" height={L.trendH}>
                    <ComposedChart data={trendPoints} margin={{ top: 4, right: 4, left: L.leftMargin, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#e2ab41" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#e2ab41" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#22c55e" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="day" tick={xTick} axisLine={false} tickLine={false} interval="preserveStartEnd"
                        label={{ value: 'Date', position: 'insideBottom', offset: -2, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                      />
                      <YAxis tick={yTick} axisLine={false} tickLine={false} allowDecimals={false}
                        label={{ value: 'Tasks', angle: -90, position: 'insideLeft', offset: 14, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      {!L.isMobile && (
                        <Legend iconType="circle" iconSize={7}
                          formatter={(v) => <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{v}</span>} />
                      )}
                      <Area type="monotone" dataKey="created"   name="Created"   fill="url(#gC)" stroke="#e2ab41" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="completed" name="Completed" fill="url(#gD)" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line  type="monotone" dataKey="overdue"   name="Overdue"   stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
              }
              {L.isMobile && (
                <div className="insightsLegendRow">
                  <LegendItem color="#e2ab41" label="Created" />
                  <LegendItem color="#22c55e" label="Completed" />
                  <LegendItem color="#ef4444" label="Overdue" />
                </div>
              )}
            </ChartCard>

            <ChartCard title="Status Mix" icon={<IconTarget size={14} />}>
              <ResponsiveContainer width="100%" height={L.chartH}>
                <PieChart>
                  <Pie data={stats.statusPie} cx="50%" cy="50%"
                    outerRadius={L.donutOuter} innerRadius={L.donutInner}
                    dataKey="value" nameKey="name">
                    {stats.statusPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  {!L.isMobile && (
                    <Legend iconType="circle" iconSize={7}
                      formatter={(v) => <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{v}</span>} />
                  )}
                </PieChart>
              </ResponsiveContainer>
              {L.isMobile && (
                <div className="insightsLegendGrid">
                  {stats.statusPie.slice(0, 6).map(e => (
                    <LegendItem key={e.status} color={e.fill} label={e.name} />
                  ))}
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Row 2: Workload + Priority + Category + Radar ── */}
          <div className="insightsRow2" style={{ '--row2-cols': L.row2Cols } as React.CSSProperties}>
            {workloadBars.length > 0 && (
              <ChartCard title="Team Workload" icon={<IconWorkload size={14} />}>
                <ResponsiveContainer width="100%" height={L.chartH}>
                  <BarChart data={workloadBars} margin={{ top: 4, right: 8, left: L.leftMargin, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" tick={xTick} axisLine={false} tickLine={false}
                      label={{ value: 'Team Member', position: 'insideBottom', offset: -2, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                    />
                    <YAxis tick={yTick} axisLine={false} tickLine={false} allowDecimals={false}
                      label={{ value: 'Tasks', angle: -90, position: 'insideLeft', offset: 12, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="done" name="Done" stackId="a" fill="#22c55e" radius={[0,0,0,0]} />
                    <Bar dataKey="open" name="Open" stackId="a" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {priorityBars.length > 0 && (
              <ChartCard title="Priority Breakdown" icon={<IconLightning size={14} />}>
                <ResponsiveContainer width="100%" height={Math.max(L.chartH, priorityBars.length * (L.isMobile ? 32 : 38))}>
                  <BarChart data={priorityBars} layout="vertical"
                    margin={{ top: 4, right: L.isMobile ? 16 : 24, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={xTick} axisLine={false} tickLine={false} allowDecimals={false}
                      label={{ value: 'Number of Tasks', position: 'insideBottom', offset: -2, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                    />
                    <YAxis type="category" dataKey="name" tick={{ ...yTick, fontWeight: 800 }}
                      axisLine={false} tickLine={false} width={L.isMobile ? 48 : 56}
                      label={{ value: 'Priority', angle: -90, position: 'insideLeft', offset: 14, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" name="Tasks" radius={[0,6,6,0]}>
                      {priorityBars.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {stats.topCategories.length > 0 && (
              <ChartCard title="Tasks by Project" icon={<IconClipboard size={14} />}>
                <ResponsiveContainer width="100%" height={Math.max(L.chartH, stats.topCategories.length * (L.isMobile ? 32 : 38))}>
                  <BarChart
                    data={stats.topCategories.map(([name, count]) => ({
                      name: L.isMobile && name.length > 9 ? name.slice(0,9)+'…' : name.length > 12 ? name.slice(0,12)+'…' : name,
                      count,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: L.isMobile ? 16 : 24, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={xTick} axisLine={false} tickLine={false} allowDecimals={false}
                      label={{ value: 'Number of Tasks', position: 'insideBottom', offset: -2, style: { fill: 'var(--muted)', fontSize: 9, fontWeight: 700 } }}
                    />
                    <YAxis type="category" dataKey="name" tick={{ ...yTick, fontWeight: 700 }}
                      axisLine={false} tickLine={false} width={L.yAxisW} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Tasks" fill="#e2ab41" radius={[0,6,6,0]} fillOpacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {priorityBars.length >= 3 && (
              <ChartCard title="Priority Pressure" icon={<IconTarget size={14} />}>
                <ResponsiveContainer width="100%" height={L.radarH}>
                  <RadarChart data={priorityBars.map(b => ({ label: b.name, value: b.value }))}>
                    <PolarGrid stroke="rgba(255,255,255,0.09)" />
                    <PolarAngleAxis dataKey="label"
                      tick={{ fill: 'var(--muted)', fontSize: L.isMobile ? 9 : 11, fontWeight: 700 }} />
                    <Radar name="Tasks" dataKey="value"
                      stroke="#e2ab41" fill="#e2ab41" fillOpacity={0.22} strokeWidth={2} />
                    <Tooltip content={<ChartTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          {/* ── Smart Insights ── */}
          <div className="card insightsInsightSection">
            <div className="insightsChartTitle">
              <span className="insightsChartIcon"><IconRobot size={14} /></span>
              Smart Insights
              <span className="insightsMeta">· computed from {stats.total} tasks</span>
            </div>
            <div className="insightsInsightGrid">
              {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
            </div>
          </div>

          {/* ── Workload tiles ── */}
          {stats.topAssignees.length > 0 && (
            <div className="card">
              <div className="insightsChartTitle">
                <span className="insightsChartIcon"><IconUsers size={14} /></span>
                Heaviest Workload
              </div>
              <div className="insightsWorkloadGrid"
                style={{ '--wl-cols': L.workloadCols } as React.CSSProperties}>
                {stats.topAssignees.map(([name, count]) => {
                  const max   = stats.topAssignees[0]?.[1] || 1
                  const pct   = Math.round((count / max) * 100)
                  const color = count > 12 ? '#ef4444' : count > 7 ? '#f59e0b' : '#22c55e'
                  const initials = name.split(' ').map((s: string) => s[0]).slice(0,2).join('')
                  return (
                    <div key={name} className="insightsWorkloadTile">
                      <div className="insightsWorkloadTileHead">
                        <div className="insightsWorkloadAvatar" style={{ '--av-color': color } as React.CSSProperties}>
                          {initials}
                        </div>
                        <div className="insightsWorkloadName">{name}</div>
                        <span className="insightsWorkloadCount" style={{ color }}>{count}</span>
                      </div>
                      <div className="insightsWorkloadBar">
                        <div className="insightsWorkloadBarFill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Empty state ── */}
      {!loading && !stats && (
        <div className="card insightsEmpty--full">
          <IconBarChart size={36} color="var(--muted)" />
          <div className="insightsEmptyTitle">No task data yet</div>
          <div className="insightsEmptySub">Create tasks and assign them to your team to see insights here.</div>
        </div>
      )}
    </div>
  )
}
