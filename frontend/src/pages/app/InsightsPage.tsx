import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconAlertTriangle, IconAward, IconBarChart, IconCheckCircle,
  IconClipboard, IconCritical, IconFlag, IconLightning,
  IconOverdue, IconRisk, IconUsers, IconTarget, IconWorkload,
  IconRobot,
} from '../../components/ui/AppIcons'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { useRealtimeInvalidation } from '../../lib/socket'
import { Select } from '../../components/ui/Select'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { PageLiveCharts } from '../../components/charts/PageLiveCharts'
import { KpiStrip } from '../../components/ui/KpiCard'

type TaskRow = {
  status: string
  priority?: string | null
  assigned_to_name?: string | null
  due_date?: string | null
  category_name?: string | null
}
type WorkloadRow = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }
type AnalyticsSummary = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  overdue_tasks: number
  active_employees: number
  avg_completion_hours?: string | number
  avg_ai_confidence?: string | number
}
type StatusPoint = { status: string; count: number }
type TrendPoint = { day: string; completed?: number; created?: number; overdue?: number }
type PriorityPoint = { priority: string; count: number }

type NamedCount = { name: string; value: number; fill: string; key?: string }

type InsightTone = 'positive' | 'warning' | 'danger' | 'neutral'

type Insight = { icon: ReactNode; title: string; body: string; tone: InsightTone }

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
  low: '#38bdf8', medium: '#8b5cf6', high: '#f97316', critical: '#ef4444', urgent: '#dc2626', unspecified: '#94a3b8',
}

function titleize(value: string) {
  return String(value || 'unspecified').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function compactDate(value: string) {
  const text = String(value || '')
  return text.includes('-') ? text.slice(5, 10) : text
}

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function normalizePriority(value?: string | null) {
  return String(value || 'unspecified').toLowerCase().trim() || 'unspecified'
}

function normalizeStatus(value?: string | null) {
  return String(value || 'unknown').toLowerCase().trim() || 'unknown'
}

function fetchTasks() {
  return apiFetch<{ tasks: TaskRow[] }>('/api/v1/tasks?limit=500&page=1').then(d => d.tasks || [])
}
function fetchSummary(days: number) {
  return apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?days=${days}`)
}
function fetchStatus(days: number) {
  return apiFetch<{ statuses: StatusPoint[] }>(`/api/v1/analytics/task-status?days=${days}`).then(d => d.statuses || [])
}
function fetchTrend(days: number) {
  return apiFetch<{ points: TrendPoint[] }>(`/api/v1/analytics/tasks-over-time?days=${days}`).then(d => d.points || [])
}
function fetchPriority(days: number) {
  return apiFetch<{ priorities: PriorityPoint[] }>(`/api/v1/analytics/priority-breakdown?days=${days}`).then(d => d.priorities || [])
}
function fetchWorkload(days: number) {
  return apiFetch<{ employees: WorkloadRow[] }>(`/api/v1/analytics/workload?days=${days}`).then(d => d.employees || [])
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

function EmptyChart({ title, detail = 'No matching records for this period.' }: { title: string; detail?: string }) {
  return (
    <div className="chartEmptyState">
      <div>
        <IconBarChart size={20} color="var(--muted)" />
        <div style={{ marginTop: 8, fontWeight: 900 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>{detail}</div>
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

function InsightCard({ icon, title, body, tone = 'neutral' }: Insight) {
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

function MiniMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 72 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 950, color }}>{value}</div>
    </div>
  )
}

function ActivityTrend({ points }: { points: TrendPoint[] }) {
  const data = points.map(p => ({
    day: compactDate(p.day),
    created: Number(p.created || 0),
    completed: Number(p.completed || 0),
    overdue: Number(p.overdue || 0),
  }))
  const max = Math.max(1, ...data.flatMap(d => [d.created, d.completed, d.overdue]))
  const total = data.reduce((s, d) => s + d.created + d.completed + d.overdue, 0)
  if (!data.length || total === 0) return <EmptyChart title="No activity trend yet" detail="Created, completed, and overdue task movement will appear here." />

  const W = 720, H = 240, L = 42, R = 18, T = 18, B = 38
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const linePath = (key: 'created' | 'completed' | 'overdue') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[key])}`).join(' ')
  const areaPath = (key: 'created' | 'completed') => `${linePath(key)} L${x(data.length - 1)},${H - B} L${x(0)},${H - B} Z`
  const tickEvery = Math.max(1, Math.ceil(data.length / 6))

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="240" role="img" aria-label="Task activity trend">
        <defs>
          <linearGradient id="insCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2ab41" stopOpacity="0.35" /><stop offset="100%" stopColor="#e2ab41" stopOpacity="0.03" /></linearGradient>
          <linearGradient id="insDone" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" /><stop offset="100%" stopColor="#22c55e" stopOpacity="0.03" /></linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map((n) => {
          const yy = T + n * (H - T - B)
          const value = Math.round(max * (1 - n))
          return <g key={n}><line x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(148,163,184,.16)" strokeDasharray="4 4" /><text x={L - 10} y={yy + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{value}</text></g>
        })}
        <path d={areaPath('created')} fill="url(#insCreated)" />
        <path d={areaPath('completed')} fill="url(#insDone)" />
        <path d={linePath('created')} fill="none" stroke="#e2ab41" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={linePath('completed')} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={linePath('overdue')} fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => i % tickEvery === 0 || i === data.length - 1 ? <text key={d.day} x={x(i)} y={H - 12} textAnchor="middle" fontSize="10" fill="var(--muted)" fontWeight="700">{d.day}</text> : null)}
        {data.map((d, i) => (
          <g key={`${d.day}-${i}`}>
            {d.created > 0 && <circle cx={x(i)} cy={y(d.created)} r="3.5" fill="#e2ab41" />}
            {d.completed > 0 && <circle cx={x(i)} cy={y(d.completed)} r="3.5" fill="#22c55e" />}
            {d.overdue > 0 && <circle cx={x(i)} cy={y(d.overdue)} r="3.5" fill="#ef4444" />}
          </g>
        ))}
      </svg>
      <div className="insightsLegendRow">
        <LegendItem color="#e2ab41" label="Created" />
        <LegendItem color="#22c55e" label="Completed" />
        <LegendItem color="#ef4444" label="Overdue" />
      </div>
    </div>
  )
}

function StatusDonut({ entries }: { entries: NamedCount[] }) {
  const data = entries.filter(e => e.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <EmptyChart title="No status mix yet" />

  let cursor = 0
  const stops = data.map(d => {
    const start = cursor
    const end = cursor + (d.value / total) * 100
    cursor = end
    return `${d.fill} ${start}% ${end}%`
  }).join(', ')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) minmax(0, 1fr)', gap: 16, alignItems: 'center', minHeight: 220 }}>
      <div style={{ position: 'relative', width: 'min(190px, 100%)', aspectRatio: '1 / 1', borderRadius: '50%', background: `conic-gradient(${stops})`, margin: '0 auto', boxShadow: 'inset 0 0 0 32px var(--card, #fff)' }}>
        <div style={{ position: 'absolute', inset: '34%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 950 }}>{total}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800, textTransform: 'uppercase' }}>Tasks</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.slice(0, 7).map(d => (
          <div key={d.key || d.name} style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 850 }}>
              <span style={{ color: d.fill }}>{d.name}</span><span>{d.value}</span>
            </div>
            <div style={{ height: 5, borderRadius: 99, background: 'rgba(148,163,184,.15)', overflow: 'hidden' }}>
              <div style={{ width: `${pct(d.value, total)}%`, height: '100%', borderRadius: 99, background: d.fill }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HorizontalBars({ entries, label = 'Tasks' }: { entries: NamedCount[]; label?: string }) {
  const data = entries.filter(e => e.value > 0)
  const max = Math.max(1, ...data.map(d => d.value))
  if (!data.length) return <EmptyChart title={`No ${label.toLowerCase()} breakdown yet`} />
  return (
    <div style={{ display: 'grid', gap: 10, padding: '8px 0' }}>
      {data.map(d => (
        <div key={d.key || d.name} style={{ display: 'grid', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: d.fill }}>{d.name}</span>
            <span style={{ fontSize: 13, fontWeight: 950 }}>{d.value}</span>
          </div>
          <div style={{ height: 12, borderRadius: 99, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(4, Math.round((d.value / max) * 100))}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${d.fill}, ${d.fill}99)` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkloadChart({ rows }: { rows: WorkloadRow[] }) {
  const data = rows.filter(r => Number(r.total_tasks || 0) > 0 || Number(r.open_tasks || 0) > 0).slice(0, 8)
  const max = Math.max(1, ...data.map(r => Number(r.total_tasks || 0)))
  if (!data.length) return <EmptyChart title="No workload data yet" />
  return (
    <div style={{ display: 'grid', gap: 11, padding: '8px 0' }}>
      {data.map(row => {
        const open = Number(row.open_tasks || 0)
        const done = Math.max(0, Number(row.total_tasks || 0) - open)
        const total = Math.max(1, open + done)
        return (
          <div key={row.employee_id || row.employee_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{row.employee_name || 'Unassigned'}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 800 }}>{open} open / {total} total</span>
            </div>
            <div style={{ width: `${Math.max(18, (total / max) * 100)}%`, maxWidth: '100%', display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', background: 'rgba(148,163,184,.14)' }}>
              <div style={{ width: `${pct(done, total)}%`, background: '#22c55e' }} />
              <div style={{ width: `${pct(open, total)}%`, background: '#8b5cf6' }} />
            </div>
          </div>
        )
      })}
      <div className="insightsLegendRow"><LegendItem color="#22c55e" label="Done" /><LegendItem color="#8b5cf6" label="Open" /></div>
    </div>
  )
}

function PriorityRadar({ entries }: { entries: NamedCount[] }) {
  const data = entries.filter(e => e.value > 0).slice(0, 6)
  if (data.length < 3) return <EmptyChart title="Not enough priority dimensions" detail="Radar appears when three or more priority levels have data." />
  const W = 300, H = 230, cx = 150, cy = 112, r = 78
  const max = Math.max(1, ...data.map(d => d.value))
  const points = data.map((d, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / data.length
    const rr = r * (d.value / max)
    return { ...d, x: cx + Math.cos(angle) * rr, y: cy + Math.sin(angle) * rr, lx: cx + Math.cos(angle) * (r + 26), ly: cy + Math.sin(angle) * (r + 26) }
  })
  const polygon = points.map(p => `${p.x},${p.y}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="230" role="img" aria-label="Priority pressure radar">
      {[.25, .5, .75, 1].map(n => <circle key={n} cx={cx} cy={cy} r={r * n} fill="none" stroke="rgba(148,163,184,.16)" />)}
      {points.map((p, i) => <line key={`axis-${i}`} x1={cx} y1={cy} x2={p.lx} y2={p.ly} stroke="rgba(148,163,184,.14)" />)}
      <polygon points={polygon} fill="#e2ab41" fillOpacity="0.22" stroke="#e2ab41" strokeWidth="3" />
      {points.map(p => <circle key={`dot-${p.name}`} cx={p.x} cy={p.y} r="4" fill={p.fill} />)}
      {points.map(p => <text key={`label-${p.name}`} x={p.lx} y={p.ly} textAnchor={p.lx > cx + 8 ? 'start' : p.lx < cx - 8 ? 'end' : 'middle'} fontSize="10" fontWeight="800" fill="var(--muted)">{p.name}</text>)}
    </svg>
  )
}

export function InsightsPage() {
  const [days, setDays] = useState('30d')
  const dayNum = parseInt(days, 10) || 30
  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })

  const tasksQ = useQuery(liveAnalyticsQueryOptions<TaskRow[]>({ queryKey: ['insights-tasks', dayNum], queryFn: fetchTasks }))
  const summaryQ = useQuery(liveAnalyticsQueryOptions<AnalyticsSummary>({ queryKey: ['insights-summary', dayNum], queryFn: () => fetchSummary(dayNum) }))
  const statusQ = useQuery(liveAnalyticsQueryOptions<StatusPoint[]>({ queryKey: ['insights-status', dayNum], queryFn: () => fetchStatus(dayNum) }))
  const trendQ = useQuery(liveAnalyticsQueryOptions<TrendPoint[]>({ queryKey: ['insights-trend', dayNum], queryFn: () => fetchTrend(dayNum) }))
  const priorityQ = useQuery(liveAnalyticsQueryOptions<PriorityPoint[]>({ queryKey: ['insights-priority', dayNum], queryFn: () => fetchPriority(dayNum) }))
  const workloadQ = useQuery(liveAnalyticsQueryOptions<WorkloadRow[]>({ queryKey: ['insights-workload', dayNum], queryFn: () => fetchWorkload(dayNum) }))

  const tasks = tasksQ.data || []
  const summary = summaryQ.data
  const statusPoints = statusQ.data || []
  const priorityPoints = priorityQ.data || []
  const workload = workloadQ.data || []
  const trend = trendQ.data || []

  const fallbackStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks) counts[normalizeStatus(t.status)] = (counts[normalizeStatus(t.status)] || 0) + 1
    return counts
  }, [tasks])

  const statusEntries = useMemo<NamedCount[]>(() => {
    const source = statusPoints.length
      ? Object.fromEntries(statusPoints.map(p => [normalizeStatus(p.status), Number(p.count || 0)]))
      : fallbackStatusCounts
    return Object.entries(source)
      .map(([key, value]) => ({ key, name: titleize(key), value: Number(value || 0), fill: STATUS_COLORS[key] || '#94a3b8' }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [fallbackStatusCounts, statusPoints])

  const priorityEntries = useMemo<NamedCount[]>(() => {
    const fallback: Record<string, number> = {}
    for (const t of tasks) fallback[normalizePriority(t.priority)] = (fallback[normalizePriority(t.priority)] || 0) + 1
    const source = priorityPoints.length
      ? Object.fromEntries(priorityPoints.map(p => [normalizePriority(p.priority), Number(p.count || 0)]))
      : fallback
    const order = ['urgent', 'critical', 'high', 'medium', 'low', 'unspecified']
    return order
      .filter(k => Number(source[k] || 0) > 0)
      .map(k => ({ key: k, name: titleize(k), value: Number(source[k] || 0), fill: PRIORITY_COLORS[k] || '#94a3b8' }))
  }, [priorityPoints, tasks])

  const projectEntries = useMemo<NamedCount[]>(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks) {
      const name = String(t.category_name || '').trim()
      if (name) counts[name] = (counts[name] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value], i) => ({ key: name, name, value, fill: ['#e2ab41', '#8b5cf6', '#38bdf8', '#22c55e', '#f97316', '#ef4444', '#06b6d4', '#94a3b8'][i % 8] }))
  }, [tasks])

  const total = Number(summary?.total_tasks ?? statusEntries.reduce((s, d) => s + d.value, 0))
  const completed = Number(summary?.completed_tasks ?? ((statusEntries.find(d => d.key === 'completed')?.value || 0) + (statusEntries.find(d => d.key === 'manager_approved')?.value || 0)))
  const overdue = Number(summary?.overdue_tasks ?? (statusEntries.find(d => d.key === 'overdue')?.value || 0))
  const inProgress = statusEntries.find(d => d.key === 'in_progress')?.value || 0
  const pending = Number(summary?.pending_tasks ?? (statusEntries.find(d => d.key === 'pending')?.value || 0))
  const submitted = statusEntries.find(d => d.key === 'submitted')?.value || 0
  const completionRate = total ? Math.round((completed / total) * 100) : 0
  const overdueRate = total ? Math.round((overdue / total) * 100) : 0
  const avgOpenTasks = workload.length ? (workload.reduce((s, w) => s + Number(w.open_tasks || 0), 0) / workload.length).toFixed(1) : '—'
  const overloadedPeople = workload.filter(w => Number(w.open_tasks || 0) > Math.max(5, Number(avgOpenTasks || 0) * 1.5))

  const topAssignees = useMemo(() => workload
    .filter(w => Number(w.open_tasks || 0) > 0)
    .sort((a, b) => Number(b.open_tasks || 0) - Number(a.open_tasks || 0))
    .slice(0, 8), [workload])

  const insights = useMemo<Insight[]>(() => {
    if (!total) return []
    const items: Insight[] = []
    if (completionRate >= 80) items.push({ icon: <IconAward size={14} />, title: 'Strong completion rate', body: `${completionRate}% of tasks completed — your team is executing well.`, tone: 'positive' })
    else if (completionRate < 50) items.push({ icon: <IconAlertTriangle size={14} />, title: 'Low completion rate', body: `Only ${completionRate}% completed. Review workloads and deadlines.`, tone: 'warning' })
    if (overdueRate > 20) items.push({ icon: <IconRisk size={14} />, title: 'High overdue rate', body: `${overdue} tasks (${overdueRate}%) overdue. Reassign or extend deadlines.`, tone: 'danger' })
    else if (overdue === 0) items.push({ icon: <IconCheckCircle size={14} />, title: 'No overdue tasks', body: 'All tasks are within deadline based on current analytics.', tone: 'positive' })
    const critical = priorityEntries.find(p => p.key === 'critical')?.value || 0
    if (critical > 0) items.push({ icon: <IconCritical size={14} />, title: `${critical} critical tasks`, body: 'Ensure these have active owners and are unblocked.', tone: 'danger' })
    if (overloadedPeople.length > 0) items.push({ icon: <IconUsers size={14} />, title: `${overloadedPeople.length} overloaded`, body: `${overloadedPeople.map(p => p.employee_name).join(', ')} have above-average open workloads.`, tone: 'warning' })
    if (submitted > 0) items.push({ icon: <IconClipboard size={14} />, title: `${submitted} awaiting review`, body: 'Review submitted tasks to unblock completion flow.', tone: 'neutral' })
    if (pending > inProgress * 2 && pending > 0) items.push({ icon: <IconFlag size={14} />, title: 'Many tasks not started', body: `${pending} pending vs ${inProgress} in progress. Triage the backlog.`, tone: 'warning' })
    if (!items.length) items.push({ icon: <IconBarChart size={14} />, title: 'Operations look healthy', body: 'No significant issues detected in the selected period.', tone: 'positive' })
    return items
  }, [completionRate, inProgress, overdue, overdueRate, overloadedPeople, pending, priorityEntries, submitted, total])

  const loading = summaryQ.isLoading || statusQ.isLoading || trendQ.isLoading || workloadQ.isLoading
  const anyError = summaryQ.isError || statusQ.isError || trendQ.isError || priorityQ.isError || workloadQ.isError

  return (
    <div className="insightsPage">
      <PageHeaderCard
        title="Insights"
        subtitle="Real-time performance analysis from live analytics data"
        actions={<div className="insightsRangeSelect"><Select value={days} onChange={setDays} options={RANGE_OPTS} /></div>}
      />

      {anyError && (
        <div className="alertV4 alertV4Error">
          Some analytics endpoints failed to load. The page is showing all available live data and will retry automatically.
        </div>
      )}

      <PageLiveCharts title="Live insights overview" days={dayNum} />

      <KpiStrip
        loading={loading}
        skeletonCount={5}
        className="insightsKpiStrip"
        style={{ '--kpi-cols': '5' } as CSSProperties}
        items={[
          { label: 'Total Tasks', value: total, sub: 'in your org', color: '#e2ab41', icon: <IconClipboard size={28} /> },
          { label: 'Completed', value: completed, sub: `${completionRate}% rate`, color: '#22c55e', icon: <IconCheckCircle size={28} /> },
          { label: 'In Progress', value: inProgress, sub: 'active right now', color: '#8b5cf6', icon: <IconLightning size={28} /> },
          { label: 'Overdue', value: overdue, sub: `${overdueRate}% of total`, color: overdue > 0 ? '#ef4444' : '#22c55e', icon: <IconOverdue size={28} /> },
          { label: 'Avg Open / Person', value: avgOpenTasks, sub: 'workload balance', color: '#f59e0b', icon: <IconUsers size={28} />, animate: false },
        ]}
      />

      <div className="insightsRow1" style={{ '--row1-cols': 'minmax(0,2fr) minmax(0,1fr)' } as CSSProperties}>
        <ChartCard title="Activity Trend" icon={<IconBarChart size={14} />}>
          {trendQ.isLoading ? <EmptyChart title="Loading trend…" detail="Fetching live analytics series." /> : <ActivityTrend points={trend} />}
        </ChartCard>
        <ChartCard title="Status Mix" icon={<IconTarget size={14} />}>
          {statusQ.isLoading ? <EmptyChart title="Loading status mix…" detail="Fetching live status counts." /> : <StatusDonut entries={statusEntries} />}
        </ChartCard>
      </div>

      <div className="insightsRow2" style={{ '--row2-cols': 'repeat(auto-fit, minmax(260px, 1fr))' } as CSSProperties}>
        <ChartCard title="Team Workload" icon={<IconWorkload size={14} />}>
          {workloadQ.isLoading ? <EmptyChart title="Loading workload…" /> : <WorkloadChart rows={workload} />}
        </ChartCard>
        <ChartCard title="Priority Breakdown" icon={<IconLightning size={14} />}>
          {priorityQ.isLoading ? <EmptyChart title="Loading priorities…" /> : <HorizontalBars entries={priorityEntries} label="Priority" />}
        </ChartCard>
        <ChartCard title="Tasks by Project" icon={<IconClipboard size={14} />}>
          {tasksQ.isLoading ? <EmptyChart title="Loading projects…" /> : <HorizontalBars entries={projectEntries} label="Project" />}
        </ChartCard>
        <ChartCard title="Priority Pressure" icon={<IconTarget size={14} />}>
          {priorityQ.isLoading ? <EmptyChart title="Loading pressure…" /> : <PriorityRadar entries={priorityEntries} />}
        </ChartCard>
      </div>

      <div className="card insightsInsightSection">
        <div className="insightsChartTitle">
          <span className="insightsChartIcon"><IconRobot size={14} /></span>
          Smart Insights
          <span className="insightsMeta">· computed from {total} tasks</span>
        </div>
        {total ? (
          <div className="insightsInsightGrid">
            {insights.map((ins, i) => <InsightCard key={`${ins.title}-${i}`} {...ins} />)}
          </div>
        ) : (
          <EmptyChart title="No task data yet" detail="Create and assign tasks to generate insights." />
        )}
      </div>

      {topAssignees.length > 0 && (
        <div className="card">
          <div className="insightsChartTitle">
            <span className="insightsChartIcon"><IconUsers size={14} /></span>
            Heaviest Workload
          </div>
          <div className="insightsWorkloadGrid" style={{ '--wl-cols': 'repeat(auto-fit, minmax(180px, 1fr))' } as CSSProperties}>
            {topAssignees.map((row) => {
              const max = topAssignees[0]?.open_tasks || 1
              const ratio = Math.round((Number(row.open_tasks || 0) / max) * 100)
              const color = row.open_tasks > 12 ? '#ef4444' : row.open_tasks > 7 ? '#f59e0b' : '#22c55e'
              const initials = String(row.employee_name || 'U').split(' ').map(s => s[0]).slice(0, 2).join('')
              return (
                <div key={row.employee_id || row.employee_name} className="insightsWorkloadTile">
                  <div className="insightsWorkloadTileHead">
                    <div className="insightsWorkloadAvatar" style={{ '--av-color': color } as CSSProperties}>{initials}</div>
                    <div className="insightsWorkloadName">{row.employee_name || 'Unassigned'}</div>
                    <span className="insightsWorkloadCount" style={{ color }}>{row.open_tasks}</span>
                  </div>
                  <div className="insightsWorkloadBar"><div className="insightsWorkloadBarFill" style={{ width: `${ratio}%`, background: color }} /></div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <MiniMetric label="Live Statuses" value={statusEntries.length} color="#38bdf8" />
        <MiniMetric label="Priority Levels" value={priorityEntries.length} color="#e2ab41" />
        <MiniMetric label="People Loaded" value={workload.length} color="#22c55e" />
        <MiniMetric label="Projects Loaded" value={projectEntries.length} color="#8b5cf6" />
      </div>
    </div>
  )
}
