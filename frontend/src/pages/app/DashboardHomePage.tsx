import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
  ComposedChart,
} from 'recharts'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'

// ─── Types ───────────────────────────────────────────────────────
type DashData = {
  tasks: {
    total: number; pending: number; in_progress: number; submitted: number
    completed: number; overdue: number; cancelled: number
    completion_rate: number; due_today: number; due_week: number
  }
  trend: Array<{ day: string; label: string; completed: number; overdue: number; created: number }>
  projects: Array<{
    id: string; name: string; color?: string | null; total: number
    completed: number; overdue: number; in_progress: number; pending: number
    progress: number; start_date: string; earliest_due?: string; latest_due?: string
  }>
  leaderboard: Array<{
    id: string; name: string; department?: string | null; role?: string | null
    total: number; completed: number; overdue: number; in_progress: number
    completion_rate: number; score: number
  }>
  priority: Record<string, number>
  velocity: Array<{ week: string; week_start: string; created: number; completed: number }>
  projectStatusChart: Array<Record<string, any>>
}

// ─── Fetch ───────────────────────────────────────────────────────
async function fetchDash(): Promise<DashData> {
  return apiFetch<DashData>('/api/v1/stats/dashboard')
}

// ─── Colors ──────────────────────────────────────────────────────
const C = {
  brand: '#e2ab41', purple: '#8B5CF6', blue: '#38bdf8', green: '#22c55e',
  red: '#ef4444', orange: '#f97316', teal: '#14b8a6', pink: '#ec4899',
  indigo: '#6366f1', amber: '#f59e0b',
}
const STATUS_C: Record<string, string> = {
  pending: C.amber, in_progress: C.purple, submitted: C.blue,
  completed: C.green, manager_approved: C.green, overdue: C.red, cancelled: '#9ca3af',
}
const PRIORITY_C: Record<string, string> = {
  low: C.blue, medium: C.purple, high: C.orange, critical: C.red, urgent: C.red,
}
const PLAYER_COLORS = [C.brand, C.purple, C.blue, C.green, C.teal, C.pink, C.indigo, C.orange]

// ─── Shared tooltip ──────────────────────────────────────────────
function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 16px 40px rgba(0,0,0,0.35)', fontSize: 12 }}>
      {label && <div style={{ fontWeight: 900, fontSize: 10, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i > 0 ? 5 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, flexShrink: 0 }} />
          <span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 900, color: 'var(--text)' }}>{typeof p.value === 'number' ? (Number.isInteger(p.value) ? p.value : p.value.toFixed(1)) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon, trend }: { label: string; value: string | number; sub?: string; color?: string; icon: React.ReactNode; trend?: number }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px 20px', position: 'relative', overflow: 'hidden', flex: 1, minWidth: 140 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color || C.brand }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: (color || C.brand) + '18', border: `1.5px solid ${(color || C.brand)}28`, color: color || C.brand, display: 'grid', placeItems: 'center' }}>{icon}</div>
        {trend !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 800, color: trend >= 0 ? C.green : C.red, padding: '2px 7px', borderRadius: 999, background: (trend >= 0 ? C.green : C.red) + '18' }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: '-1px', color: 'var(--text)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Chart Container ─────────────────────────────────────────────
function ChartBox({ title, subtitle, children, span = 1, action }: { title: string; subtitle?: string; children: React.ReactNode; span?: number; action?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', gridColumn: `span ${span}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: '-0.3px', color: 'var(--text)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── Main Dashboard ──────────────────────────────────────────────
export function DashboardHomePage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery<DashData>({
    queryKey: ['dashboard', 'full'],
    queryFn: fetchDash,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const tasks = data?.tasks
  const trend = data?.trend || []
  const projects = data?.projects || []
  const leaderboard = data?.leaderboard || []
  const velocity = data?.velocity || []
  const projectStatusChart = data?.projectStatusChart || []

  // Priority pie data
  const priorityPie = useMemo(() => Object.entries(data?.priority || {}).map(([k, v]) => ({ name: k, value: v, fill: PRIORITY_C[k] || C.brand })), [data])

  // Status donut data
  const statusPie = useMemo(() => {
    if (!tasks) return []
    return [
      { name: 'Pending',    value: tasks.pending,    fill: C.amber   },
      { name: 'In Progress',value: tasks.in_progress, fill: C.purple  },
      { name: 'Submitted',  value: tasks.submitted,  fill: C.blue    },
      { name: 'Completed',  value: tasks.completed,  fill: C.green   },
      { name: 'Overdue',    value: tasks.overdue,    fill: C.red     },
    ].filter(d => d.value > 0)
  }, [tasks])

  // Trend slice — last 14 days for cleaner chart
  const recentTrend = trend.slice(-14)

  // Completion rate by employee — bar chart
  const employeeBar = leaderboard.slice(0, 8).map(u => ({
    name: u.name.split(' ')[0],
    fullName: u.name,
    'Completion %': u.completion_rate || 0,
    'Score': u.score || 0,
    completed: u.completed,
    total: u.total,
    overdue: u.overdue,
  }))

  // Project progress bars
  const projectBars = projects.slice(0, 8).map(p => ({
    name: p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name,
    fullName: p.name,
    Progress: p.progress,
    Completed: p.completed,
    Remaining: p.total - p.completed,
    Overdue: p.overdue,
    color: p.color || C.brand,
  }))

  // Gantt-style timeline data
  const now = Date.now()
  const ganttProjects = projects
    .filter(p => p.start_date)
    .slice(0, 8)
    .map(p => {
      const start = new Date(p.start_date).getTime()
      const end = p.latest_due ? new Date(p.latest_due).getTime() : start + 30 * 86400000
      const duration = end - start
      const elapsed = Math.max(0, Math.min(now - start, duration))
      const pct = duration > 0 ? (elapsed / duration) * 100 : 0
      return { ...p, start, end, duration, pct: Math.round(pct) }
    })

  if (isLoading) return (
    <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ display: 'block', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div style={{ fontWeight: 800 }}>Loading dashboard…</div>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* ── Header ── */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </div>
            <div className="pageHeaderCardSub">
              AI-powered real-time analytics • {tasks?.total || 0} tasks across {projects.length} projects • Auto-refreshes every 60s
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">📊 Live data</span>
              {tasks?.overdue ? <span className="pageHeaderCardTag" style={{ color: C.red, background: C.red + '12', borderColor: C.red + '30' }}>⚠ {tasks.overdue} overdue</span> : null}
              {tasks?.due_today ? <span className="pageHeaderCardTag" style={{ color: C.orange, background: C.orange + '12', borderColor: C.orange + '30' }}>⏰ {tasks.due_today} due today</span> : null}
              {tasks?.completion_rate !== undefined && <span className="pageHeaderCardTag" style={{ color: C.green, background: C.green + '12', borderColor: C.green + '30' }}>✓ {tasks.completion_rate}% complete</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canCreate && (
              <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Task
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <KpiCard label="Total Tasks" value={tasks?.total || 0} sub={`${tasks?.due_today || 0} due today`} color={C.brand}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>} />
        <KpiCard label="In Progress" value={tasks?.in_progress || 0} sub="Active work" color={C.purple}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>} />
        <KpiCard label="Completed" value={tasks?.completed || 0} sub={`${tasks?.completion_rate || 0}% rate`} color={C.green}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>} />
        <KpiCard label="Overdue" value={tasks?.overdue || 0} sub={`${tasks?.due_week || 0} due this week`} color={C.red}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>} />
        <KpiCard label="Pending Review" value={tasks?.submitted || 0} sub="Awaiting approval" color={C.blue}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>} />
        <KpiCard label="Projects" value={projects.length} sub={`${projects.filter(p=>p.progress===100).length} completed`} color={C.teal}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>} />
      </div>

      {/* ── Row 1: Trend + Status Donut ── */}
      <div className="dashResponsiveGrid dashResponsiveGrid--2-1" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <ChartBox title="Task Activity — Last 14 Days" subtitle="Created · Completed · Overdue by day">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={recentTrend}>
              <defs>
                <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.green} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.green} stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.brand} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={C.brand} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="created" name="Created" fill="url(#gradCreated)" stroke={C.brand} strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="completed" name="Completed" fill="url(#gradCompleted)" stroke={C.green} strokeWidth={2} dot={false} />
              <Bar dataKey="overdue" name="Overdue" fill={C.red} radius={[3,3,0,0]} opacity={0.8} barSize={6} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartBox>

        <ChartBox title="Task Status" subtitle="Current distribution">
          {statusPie.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={statusPie} cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={3} dataKey="value">
                    {statusPie.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<Tip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                {statusPie.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.fill, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text2)', fontWeight: 600 }}>{s.name}</span>
                    <span style={{ fontWeight: 900, color: 'var(--text)' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ height: 200, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No data yet</div>}
        </ChartBox>
      </div>

      {/* ── Row 2: Project Progress + Velocity ── */}
      <div className="dashResponsiveGrid dashResponsiveGrid--2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartBox title="Project Progress" subtitle="Completion % per project">
          {projectBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={projectBars} layout="vertical" margin={{ left: 0, right: 20 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => v + '%'} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text2)', fontWeight: 700 }} axisLine={false} tickLine={false} width={80} />
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <Tooltip content={<Tip />} />
                <Bar dataKey="Progress" name="Progress %" radius={[0, 6, 6, 0]} barSize={16}
                  label={{ position: 'right', fontSize: 10, formatter: (v: any) => v + '%', fill: 'var(--muted)' }}>
                  {projectBars.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No projects yet</div>}
        </ChartBox>

        <ChartBox title="Weekly Velocity" subtitle="Tasks created vs. completed per week">
          {velocity.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={velocity} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="created" name="Created" fill={C.brand} radius={[4,4,0,0]} barSize={16} opacity={0.7} />
                <Bar dataKey="completed" name="Completed" fill={C.green} radius={[4,4,0,0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Not enough data yet</div>}
        </ChartBox>
      </div>

      {/* ── Row 3: Employee Performance ── */}
      <ChartBox title="Employee Performance Leaderboard" subtitle="Completion rate & task score per team member" span={1}
        action={<Link to="/app/analytics" className="btn btnGhost btnSm" style={{ fontSize: 11 }}>Full Analytics →</Link>}>
        {employeeBar.length > 0 ? (
          <div className="dashResponsiveGrid dashResponsiveGrid--2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={employeeBar} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => v + '%'} />
                <Tooltip content={<Tip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Completion %" radius={[6,6,0,0]} barSize={20}>
                  {employeeBar.map((_, i) => <Cell key={i} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leaderboard.slice(0, 8).map((u, i) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: PLAYER_COLORS[i % PLAYER_COLORS.length] + '20', color: PLAYER_COLORS[i % PLAYER_COLORS.length], display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{u.department || u.role || 'Team member'}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: u.completion_rate >= 70 ? C.green : u.completion_rate >= 40 ? C.amber : C.red }}>{u.completion_rate || 0}%</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{u.completed}/{u.total} done</div>
                  </div>
                  <div style={{ width: 44, height: 6, borderRadius: 999, background: 'var(--border)', flexShrink: 0, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${u.completion_rate || 0}%`, background: PLAYER_COLORS[i % PLAYER_COLORS.length], borderRadius: 999, transition: 'width 0.8s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No employee data yet</div>}
      </ChartBox>

      {/* ── Row 4: Priority + Project Status Stack + Gantt ── */}
      <div className="dashResponsiveGrid dashResponsiveGrid--1-2" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
        <ChartBox title="Priority Breakdown" subtitle="Tasks by urgency level">
          {priorityPie.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={priorityPie} cx="50%" cy="50%" outerRadius={75} paddingAngle={4} dataKey="value" label={({ name, percent }: any) => percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                    {priorityPie.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<Tip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                {priorityPie.map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: p.fill }} />
                    <span style={{ flex: 1, textTransform: 'capitalize', color: 'var(--text2)', fontWeight: 700 }}>{p.name}</span>
                    <span style={{ fontWeight: 900, color: 'var(--text)' }}>{p.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No tasks yet</div>}
        </ChartBox>

        <ChartBox title="Project Status Breakdown" subtitle="Task status distribution per project">
          {projectStatusChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={projectStatusChart} margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="project" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {['pending','in_progress','submitted','completed','overdue'].map(s => (
                  <Bar key={s} dataKey={s} name={s.replace(/_/g,' ')} stackId="a" fill={STATUS_C[s]} radius={s === 'overdue' ? [4,4,0,0] : [0,0,0,0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No project data yet</div>}
        </ChartBox>
      </div>

      {/* ── Row 5: Project Timeline (Gantt-style) ── */}
      {ganttProjects.length > 0 && (
        <ChartBox title="Project Timeline" subtitle="Visual timeline from start date to latest task due date">
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
            {ganttProjects.map((p, i) => {
              const totalSpan = ganttProjects.reduce((acc, g) => Math.max(acc, g.end), 0) - Math.min(...ganttProjects.map(g => g.start))
              const minStart = Math.min(...ganttProjects.map(g => g.start))
              const leftPct = totalSpan ? ((p.start - minStart) / totalSpan) * 100 : 0
              const widthPct = totalSpan ? (p.duration / totalSpan) * 100 : 50
              const color = p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]
              const overdueClass = p.overdue > 0
              return (
                <div key={p.id} className="dashTimelineRow" style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 10, alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, color: 'var(--text)' }} title={p.name}>{p.name}</div>
                  <div style={{ height: 24, background: 'var(--bg2)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: leftPct + '%', width: Math.max(widthPct, 4) + '%', background: color + '40', borderRadius: 999, border: `1.5px solid ${color}60` }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: leftPct + '%', width: Math.max(widthPct * (p.progress / 100), 2) + '%', background: color, borderRadius: 999 }} />
                    {overdueClass && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 900, color: C.red }}>⚠</div>}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: p.progress === 100 ? C.green : p.overdue > 0 ? C.red : 'var(--text2)', textAlign: 'right' }}>
                    {p.progress}%
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
              <div style={{ width: 20, height: 8, borderRadius: 999, background: C.green }} /> Completed portion
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
              <div style={{ width: 20, height: 8, borderRadius: 999, background: C.brand + '50', border: `1.5px solid ${C.brand}` }} /> Total span
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ color: C.red, fontWeight: 900 }}>⚠</span> Has overdue tasks
            </div>
          </div>
        </ChartBox>
      )}

      {/* ── Row 6: Task Follow-up Table ── */}
      <ChartBox title="Task Follow-up — At-Risk Items" subtitle="Overdue and pending tasks requiring immediate attention">
        <TaskFollowup />
      </ChartBox>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

// ─── Task Follow-up ───────────────────────────────────────────────
type FollowupTask = { id: string; title: string; status: string; priority?: string | null; due_date?: string | null; assigned_to_name?: string | null; category_name?: string | null }

function TaskFollowup() {
  const { data } = useQuery({
    queryKey: ['tasks', 'followup'],
    queryFn: () => apiFetch<{ tasks: FollowupTask[] }>('/api/v1/tasks?limit=50&page=1&status=overdue').then(d => d.tasks || []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const overdue = data || []

  const { data: pending } = useQuery({
    queryKey: ['tasks', 'followup-pending'],
    queryFn: () => apiFetch<{ tasks: FollowupTask[] }>('/api/v1/tasks?limit=20&page=1&status=pending').then(d => d.tasks || []),
    staleTime: 30_000,
  })

  const all = [...overdue, ...(pending || []).slice(0, 10)]

  if (!all.length) return (
    <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
      <span style={{ fontSize: 24 }}>🎉</span>
      <div style={{ fontWeight: 800, marginTop: 8 }}>All tasks on track!</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>No overdue or at-risk items.</div>
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Task', 'Project', 'Assignee', 'Priority', 'Status', 'Due'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.slice(0, 20).map(t => {
            const isOverdue = t.status === 'overdue'
            const pColor = PRIORITY_C[t.priority || ''] || '#9ca3af'
            const dueDate = t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: isOverdue ? C.red + '04' : '' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                onMouseLeave={e => (e.currentTarget.style.background = isOverdue ? C.red + '04' : '')}>
                <td style={{ padding: '9px 12px', fontWeight: 800, fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{t.title}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)' }}>{t.category_name || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{t.assigned_to_name || '—'}</td>
                <td style={{ padding: '9px 12px' }}>
                  {t.priority && <span style={{ fontSize: 10, fontWeight: 800, color: pColor, textTransform: 'capitalize', padding: '2px 8px', borderRadius: 999, background: pColor + '18' }}>{t.priority}</span>}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: isOverdue ? C.red + '18' : C.amber + '18', color: isOverdue ? C.red : C.amber, textTransform: 'capitalize' }}>
                    {isOverdue ? '⚠ Overdue' : t.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: isOverdue ? C.red : 'var(--text2)', whiteSpace: 'nowrap' }}>{dueDate}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
