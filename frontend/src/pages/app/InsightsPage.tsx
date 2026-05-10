import { useQuery } from '@tanstack/react-query'
import { IconAlertTriangle, IconAward, IconBarChart, IconCheckCircle, IconClipboard, IconCritical, IconFlag, IconLightning, IconOverdue, IconRisk, IconUsers } from '../../components/ui/AppIcons'
import { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useRealtimeInvalidation } from '../../lib/socket'
import { Select } from '../../components/ui/Select'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, ComposedChart, Area, Line,
} from 'recharts'

type TaskRow = { status: string; priority?: string; assigned_to_name?: string | null; due_date?: string | null; category_name?: string | null }
type WorkloadRow = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }

const RANGE_OPTS = [
  { value: '7d', label: 'Last 7 days' },
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

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(226,171,65,0.25)', borderRadius: 12, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 120 }}>
      {label && <div style={{ fontWeight: 900, color: 'var(--text)', marginBottom: 6, fontSize: 13 }}>{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
          <span style={{ color: p.fill || p.color || '#fff', fontWeight: 700 }}>{p.name}</span>
          <span style={{ color: '#fff', fontWeight: 900 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'var(--brand)', icon }: { label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      padding: '18px 20px', borderRadius: 16, flex: '1 1 130px', minWidth: 120,
      background: `linear-gradient(135deg, ${color}14, ${color}06)`,
      border: `1px solid ${color}28`,
    }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontSize: 10, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 950, color: 'var(--text)', letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function InsightCard({ icon, title, body, tone = 'neutral' }: { icon: React.ReactNode; title: string; body: string; tone?: 'positive' | 'warning' | 'danger' | 'neutral' }) {
  const colors = { positive: '#22c55e', warning: '#f59e0b', danger: '#ef4444', neutral: 'var(--brand)' }
  const bgs    = { positive: 'rgba(34,197,94,0.08)', warning: 'rgba(245,158,11,0.08)', danger: 'rgba(239,68,68,0.08)', neutral: 'rgba(226,171,65,0.08)' }
  return (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: bgs[tone], border: `1.5px solid ${colors[tone]}30`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: colors[tone], marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
}

export function InsightsPage() {
  const [days, setDays] = useState('30d')
  const dayNum = parseInt(days) || 30
  useRealtimeInvalidation({ tasks: true, employees: true })

  const tasksQ = useQuery({
    queryKey: ['insights-tasks', days],
    queryFn: () => apiFetch<{ tasks: TaskRow[] }>(`/api/v1/tasks?limit=500&page=1`).then(d => d.tasks || []),
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

  const stats = useMemo(() => {
    const tasks = tasksQ.data || []
    if (!tasks.length) return null
    const total      = tasks.length
    const completed  = tasks.filter(t => t.status === 'completed').length
    const overdue    = tasks.filter(t => t.status === 'overdue').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const pending    = tasks.filter(t => t.status === 'pending').length
    const submitted  = tasks.filter(t => t.status === 'submitted').length
    const completionRate = total ? Math.round((completed / total) * 100) : 0
    const overdueRate    = total ? Math.round((overdue  / total) * 100) : 0

    const byCritical = tasks.filter(t => t.priority === 'critical').length
    const byHigh     = tasks.filter(t => t.priority === 'high').length
    const byMedium   = tasks.filter(t => t.priority === 'medium').length
    const byLow      = tasks.filter(t => t.priority === 'low').length
    const byUrgent   = tasks.filter(t => t.priority === 'urgent').length

    const assigneeCounts: Record<string, number> = {}
    for (const t of tasks) {
      if (t.assigned_to_name && ['pending','in_progress','overdue'].includes(t.status)) {
        assigneeCounts[t.assigned_to_name] = (assigneeCounts[t.assigned_to_name] || 0) + 1
      }
    }
    const topAssignees = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

    const catCounts: Record<string, number> = {}
    for (const t of tasks) {
      if (t.category_name) catCounts[t.category_name] = (catCounts[t.category_name] || 0) + 1
    }
    const topCategories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)

    // Status counts for donut
    const statusCounts: Record<string, number> = {}
    for (const t of tasks) { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1 }
    const statusPie = Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace(/_/g, ' '), value, status: name, fill: STATUS_COLORS[name] || '#94a3b8',
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)

    return { total, completed, overdue, inProgress, pending, submitted, completionRate, overdueRate, byCritical, byHigh, byMedium, byLow, byUrgent, topAssignees, topCategories, statusPie }
  }, [tasksQ.data])

  const workload = workloadQ.data || []
  const avgOpenTasks = workload.length ? (workload.reduce((s, w) => s + w.open_tasks, 0) / workload.length).toFixed(1) : '—'
  const overloadedPeople = workload.filter(w => w.open_tasks > 10)

  // Trend data for area chart
  const trendPoints = useMemo(() => {
    const raw = (analyticsQ.data as any)?.points || []
    return raw.map((p: any) => ({ day: String(p.day || '').slice(5), completed: p.completed || 0, created: p.created || 0, overdue: p.overdue || 0 }))
  }, [analyticsQ.data])

  // Priority breakdown for horizontal bar
  const priorityBars = stats ? [
    { name: 'Urgent', value: stats.byUrgent, fill: PRIORITY_COLORS.urgent },
    { name: 'Critical', value: stats.byCritical, fill: PRIORITY_COLORS.critical },
    { name: 'High', value: stats.byHigh, fill: PRIORITY_COLORS.high },
    { name: 'Medium', value: stats.byMedium, fill: PRIORITY_COLORS.medium },
    { name: 'Low', value: stats.byLow, fill: PRIORITY_COLORS.low },
  ].filter(d => d.value > 0) : []

  // Team workload bar data
  const workloadBars = workload.slice(0, 8).map(w => ({
    name: w.employee_name.split(' ')[0],
    open: w.open_tasks,
    total: w.total_tasks,
    done: Math.max(0, w.total_tasks - w.open_tasks),
  }))

  // Insights
  const insights = useMemo(() => {
    if (!stats) return []
    const items: { icon: React.ReactNode; title: string; body: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }[] = []
    if (stats.completionRate >= 80) items.push({ icon: <IconAward size={14} />, title: 'Strong completion rate', body: `${stats.completionRate}% of tasks completed — your team is executing well.`, tone: 'positive' })
    else if (stats.completionRate < 50) items.push({ icon: <IconAlertTriangle size={14} />, title: 'Low completion rate', body: `Only ${stats.completionRate}% of tasks completed. Consider reviewing workloads and deadlines.`, tone: 'warning' })
    if (stats.overdueRate > 20) items.push({ icon: <IconRisk size={14} />, title: 'High overdue rate', body: `${stats.overdue} tasks (${stats.overdueRate}%) are overdue. Review and reassign or extend deadlines.`, tone: 'danger' })
    else if (stats.overdue === 0) items.push({ icon: <IconCheckCircle size={14} />, title: 'No overdue tasks', body: 'All tasks are within deadline — great scheduling discipline!', tone: 'positive' })
    if (stats.byCritical > 0) items.push({ icon: <IconCritical size={14} />, title: `${stats.byCritical} critical priority tasks`, body: `Ensure these have active owners and are unblocked.`, tone: 'danger' })
    if (overloadedPeople.length > 0) items.push({ icon: <IconUsers size={14} />, title: `${overloadedPeople.length} people overloaded`, body: `${overloadedPeople.map(p => p.employee_name).join(', ')} each have 10+ open tasks.`, tone: 'warning' })
    if (stats.submitted > 0) items.push({ icon: <IconClipboard size={14} />, title: `${stats.submitted} tasks awaiting review`, body: `Review them to unblock your team.`, tone: 'neutral' })
    if (stats.pending > stats.inProgress * 2) items.push({ icon: <IconFlag size={14} />, title: 'Many tasks not started', body: `${stats.pending} pending vs ${stats.inProgress} in progress. Triage the backlog.`, tone: 'warning' })
    if (items.length === 0) items.push({ icon: <IconBarChart size={14} />, title: 'Operations look healthy', body: 'No significant issues detected.', tone: 'positive' })
    return items
  }, [stats, overloadedPeople])

  const loading = tasksQ.isLoading || workloadQ.isLoading

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Insights
            </div>
            <div className="pageHeaderCardSub">Real-time performance analysis computed from your live task data</div>
          </div>
          <div style={{ minWidth: 160 }}>
            <Select value={days} onChange={setDays} options={RANGE_OPTS} />
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 16 }} />)}
        </div>
      )}

      {!loading && stats && (
        <>
          {/* KPI strip */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatCard label="Total Tasks"       value={stats.total}          sub="in your org"         color="#e2ab41" icon={<IconClipboard size={14} />} />
            <StatCard label="Completed"         value={stats.completed}      sub={`${stats.completionRate}% rate`} color="#22c55e" icon={<IconCheckCircle size={14} />} />
            <StatCard label="In Progress"       value={stats.inProgress}     sub="active right now"   color="#8b5cf6" icon={<IconLightning size={14} />} />
            <StatCard label="Overdue"           value={stats.overdue}        sub={`${stats.overdueRate}% of total`} color={stats.overdue > 0 ? '#ef4444' : '#22c55e'} icon={<IconOverdue size={14} />} />
            <StatCard label="Avg Open / Person" value={avgOpenTasks}         sub="workload balance"   color="#f59e0b" icon={<IconUsers size={14} />} />
          </div>

          {/* Row 1: Trend + Status Donut */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14 }}>
            {/* Trend area chart */}
            <div className="card">
              <SectionTitle>📈 Activity Trend — {dayNum} days</SectionTitle>
              {trendPoints.length < 2 ? (
                <div style={{ height: 200, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Collecting trend data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={trendPoints} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gCreated2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e2ab41" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#e2ab41" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gDone2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--muted)', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{v}</span>} />
                    <Area type="monotone" dataKey="created"   name="Created"   fill="url(#gCreated2)" stroke="#e2ab41" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="completed" name="Completed" fill="url(#gDone2)"    stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line  type="monotone" dataKey="overdue"   name="Overdue"   stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status donut */}
            <div className="card">
              <SectionTitle>🍩 Status Mix</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={stats.statusPie} cx="50%" cy="50%" outerRadius={72} innerRadius={40} dataKey="value" nameKey="name">
                    {stats.statusPie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 2: Team workload grouped bar + Priority horizontal bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {workloadBars.length > 0 && (
              <div className="card">
                <SectionTitle>👥 Team Workload Distribution</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={workloadBars} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{v}</span>} />
                    <Bar dataKey="done" name="Done"   stackId="a" fill="#22c55e" radius={[0,0,0,0]} />
                    <Bar dataKey="open" name="Open"   stackId="a" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {priorityBars.length > 0 && (
              <div className="card">
                <SectionTitle>⚡ Priority Breakdown</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={priorityBars} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11, fontWeight: 800 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" name="Tasks" radius={[0,6,6,0]}>
                      {priorityBars.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Category breakdown */}
            {stats.topCategories.length > 0 && (
              <div className="card">
                <SectionTitle>📁 Tasks by Project</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.topCategories.map(([name, count]) => ({ name: name.length > 12 ? name.slice(0,12)+'…' : name, count }))} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={72} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Tasks" fill="#e2ab41" radius={[0,6,6,0]} fillOpacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Priority radar */}
            {priorityBars.length >= 3 && (
              <div className="card">
                <SectionTitle>🎯 Priority Pressure Radar</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <RadarChart data={priorityBars.map(b => ({ label: b.name, value: b.value }))}>
                    <PolarGrid stroke="rgba(255,255,255,0.09)" />
                    <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11, fontWeight: 700 }} />
                    <Radar name="Tasks" dataKey="value" stroke="#e2ab41" fill="#e2ab41" fillOpacity={0.22} strokeWidth={2} />
                    <Tooltip content={<ChartTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Smart Insights */}
          <div className="card">
            <SectionTitle>🤖 Smart Insights <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>• computed from {stats.total} tasks</span></SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
            </div>
          </div>

          {/* Top assignees with progress bars */}
          {stats.topAssignees.length > 0 && (
            <div className="card">
              <SectionTitle>⚖️ Heaviest Workload</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                {stats.topAssignees.map(([name, count]) => {
                  const max = stats.topAssignees[0]?.[1] || 1
                  const pct = Math.round((count / max) * 100)
                  const color = count > 12 ? '#ef4444' : count > 7 ? '#f59e0b' : '#22c55e'
                  return (
                    <div key={name} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${color}18`, border: `1.5px solid ${color}35`, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, color, flexShrink: 0 }}>
                          {name.split(' ').map((s: string) => s[0]).slice(0, 2).join('')}
                        </div>
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <span style={{ fontSize: 15, fontWeight: 950, color }}>{count}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 999, background: color, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !stats && (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}><IconBarChart size={14} /></div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>No task data yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>Create tasks and assign them to your team to see insights here.</div>
        </div>
      )}
    </div>
  )
}


