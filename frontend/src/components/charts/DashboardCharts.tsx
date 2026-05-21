import type { CSSProperties } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis,
} from 'recharts'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { CHART, PRIORITY_COLORS, STATUS_COLORS } from './chartTheme'
import { ChartShell, GlassTooltip } from './ChartShell'
import { StatusDonutChart } from './PerformanceCharts'

export type ActivityPoint = { day: string; label: string; completed: number; overdue: number; created: number }

function n(v: unknown) {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

function buildPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const cp1x = p0.x + (p1.x - p0.x) / 2
    const cp2x = p0.x + (p1.x - p0.x) / 2
    d += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
}

/** Priority hero: live flow chart + completion gauge + risk bars */
export function DashboardHeroPanel(props: {
  loading?: boolean
  trend: ActivityPoint[]
  tasks?: {
    total?: number
    pending?: number
    in_progress?: number
    submitted?: number
    completed?: number
    overdue?: number
    completion_rate?: number
  }
  priority?: Record<string, number>
}) {
  const trend = props.trend || []
  const tasks = props.tasks || {}
  const priority = props.priority || {}
  const maxTrend = Math.max(1, ...trend.flatMap(d => [n(d.created), n(d.completed), n(d.overdue)]))

  const vb = { w: 920, h: 340, l: 46, r: 20, t: 24, b: 44 }
  const cw = vb.w - vb.l - vb.r
  const ch = vb.h - vb.t - vb.b
  const point = (value: number, idx: number) => ({
    x: vb.l + (idx / Math.max(trend.length - 1, 1)) * cw,
    y: vb.t + ch - (value / maxTrend) * ch,
  })

  const createdPts = trend.map((d, i) => point(n(d.created), i))
  const completedPts = trend.map((d, i) => point(n(d.completed), i))
  const overduePts = trend.map((d, i) => point(n(d.overdue), i))
  const createdPath = buildPath(createdPts)
  const completedPath = buildPath(completedPts)
  const overduePath = buildPath(overduePts)
  const completedArea = completedPath && completedPts.length
    ? `${completedPath} L ${completedPts[completedPts.length - 1].x} ${vb.h - vb.b} L ${vb.l} ${vb.h - vb.b} Z`
    : ''
  const createdArea = createdPath && createdPts.length
    ? `${createdPath} L ${createdPts[createdPts.length - 1].x} ${vb.h - vb.b} L ${vb.l} ${vb.h - vb.b} Z`
    : ''

  const total = n(tasks.total)
  const completeRate = Math.max(0, Math.min(100, n(tasks.completion_rate)))
  const completed = n(tasks.completed)
  const overdue = n(tasks.overdue)
  const active = n(tasks.in_progress) + n(tasks.submitted)
  const pending = n(tasks.pending)
  const createdTotal = trend.reduce((s, d) => s + n(d.created), 0)
  const completedTotal = trend.reduce((s, d) => s + n(d.completed), 0)
  const overdueTotal = trend.reduce((s, d) => s + n(d.overdue), 0)

  const riskRows = [
    { label: 'Critical', value: n(priority.critical), color: CHART.red },
    { label: 'High', value: n(priority.high), color: CHART.orange },
    { label: 'Medium', value: n(priority.medium), color: CHART.purple },
    { label: 'Low', value: n(priority.low), color: CHART.blue },
  ]
  const riskMax = Math.max(1, ...riskRows.map(r => r.value))

  if (props.loading) {
    return <div className="dashboardModernCard"><div className="dashboardModernEmpty">Loading realtime chart…</div></div>
  }
  if (!trend.length) {
    return <div className="dashboardModernCard"><div className="dashboardModernEmpty">No activity data yet — tasks will appear here as work begins</div></div>
  }

  return (
    <div className="dashboardModernCard">
      <div className="dashboardModernHead">
        <div>
          <div className="dashboardModernKicker">Priority analytics</div>
          <div className="dashboardModernTitle">Task flow, throughput & risk</div>
          <div className="dashboardModernSub">
            Live 14-day signal: creation vs completion vs overdue exposure, with completion health and priority risk in one responsive view.
          </div>
        </div>
        <div className="dashboardModernLive"><span className="dashboardModernLiveDot" />Live · 30s</div>
      </div>

      <div className="dashboardModernGrid">
        <div className="dashboardModernChartPanel">
          <div className="dashboardModernChartTop">
            <div className="dashboardModernLegend">
              <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: CHART.brand, color: CHART.brand }} />Created</span>
              <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: CHART.green, color: CHART.green }} />Completed</span>
              <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: CHART.red, color: CHART.red }} />Overdue</span>
            </div>
            <div className="dashboardModernMetric">{createdTotal} created · {completedTotal} completed · {overdueTotal} overdue hits</div>
          </div>
          <div className="dashboardModernSvgWrap">
            <svg className="dashboardModernSvg" viewBox={`0 0 ${vb.w} ${vb.h}`} preserveAspectRatio="none" aria-label="Task activity flow">
              <defs>
                <linearGradient id="dashCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.brand} stopOpacity="0.32" />
                  <stop offset="90%" stopColor={CHART.brand} stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="dashCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.green} stopOpacity="0.28" />
                  <stop offset="90%" stopColor={CHART.green} stopOpacity="0.02" />
                </linearGradient>
                <filter id="dashGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map(p => {
                const y = vb.t + ch * (1 - p)
                return <line key={p} x1={vb.l} y1={y} x2={vb.w - vb.r} y2={y} stroke="rgba(255,255,255,0.09)" strokeDasharray={p === 0 ? '0' : '6 8'} />
              })}
              {trend.map((d, i) => {
                const slot = cw / Math.max(trend.length - 1, 1)
                const x = vb.l + i * slot
                const label = String(d.label || d.day || '').slice(0, 5)
                return <text key={i} x={x} y={vb.h - 15} textAnchor="middle" fill="var(--muted)" fontSize="11" fontWeight="800">{label}</text>
              })}
              {createdArea && <path d={createdArea} fill="url(#dashCreated)" />}
              {completedArea && <path d={completedArea} fill="url(#dashCompleted)" />}
              {createdPath && <path d={createdPath} fill="none" stroke={CHART.brand} strokeWidth="4" strokeLinecap="round" filter="url(#dashGlow)" />}
              {completedPath && <path d={completedPath} fill="none" stroke={CHART.green} strokeWidth="4" strokeLinecap="round" filter="url(#dashGlow)" />}
              {overduePath && <path d={overduePath} fill="none" stroke={CHART.red} strokeWidth="3" strokeLinecap="round" strokeDasharray="8 8" />}
              {trend.map((_, i) => {
                const p = completedPts[i]
                return <circle key={i} cx={p.x} cy={p.y} r="4" fill={CHART.green} stroke="rgba(10,12,18,0.85)" strokeWidth="2" />
              })}
            </svg>
          </div>
        </div>

        <div className="dashboardModernSidePanel">
          <div className="dashboardModernScore">
            <div className="dashboardModernGauge" style={{ '--pct': completeRate } as CSSProperties}>
              <div className="dashboardModernGaugeInner">
                <div>
                  <div className="dashboardModernGaugeValue">{completeRate}%</div>
                  <div className="dashboardModernGaugeLabel">complete</div>
                </div>
              </div>
            </div>
            <div className="dashboardModernStats">
              <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Total</span><span className="dashboardModernStatValue">{total}</span></div>
              <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Active</span><span className="dashboardModernStatValue">{active}</span></div>
              <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Done</span><span className="dashboardModernStatValue">{completed}</span></div>
              <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Overdue</span><span className="dashboardModernStatValue">{overdue}</span></div>
            </div>
          </div>
          <div className="dashboardModernRisk">
            {riskRows.map(row => (
              <div className="dashboardModernRiskRow" key={row.label}>
                <div className="dashboardModernRiskLabel">{row.label}</div>
                <div className="dashboardModernRiskTrack">
                  <div className="dashboardModernRiskFill" style={{ '--w': `${Math.round((row.value / riskMax) * 100)}%`, '--c': row.color } as CSSProperties} />
                </div>
                <div className="dashboardModernRiskValue">{row.value}</div>
              </div>
            ))}
          </div>
          <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Pending</span><span className="dashboardModernStatValue">{pending}</span></div>
        </div>
      </div>
    </div>
  )
}

/** Composed area chart with KPI strip — used in detail modals & secondary views */
export function DashboardActivityChart({ data }: { data: ActivityPoint[] }) {
  if (!data.length) {
    return (
      <div className="chartEmptyState">No activity data yet — tasks will appear here as work begins</div>
    )
  }

  const formatted = data.map(d => ({ ...d, label: d.label || d.day.slice(5) }))
  const totalCreated = data.reduce((s, d) => s + d.created, 0)
  const totalCompleted = data.reduce((s, d) => s + d.completed, 0)
  const totalOverdue = data.reduce((s, d) => s + d.overdue, 0)
  const trend = totalCompleted >= totalCreated ? 'up' : totalCompleted >= totalCreated * 0.7 ? 'neutral' : 'down'

  return (
    <div className="dashActivityWrap">
      <div className="dashActivityKpis">
        {[
          { label: 'Created', value: totalCreated, color: CHART.brand },
          { label: 'Completed', value: totalCompleted, color: CHART.green },
          { label: 'Overdue', value: totalOverdue, color: CHART.red },
        ].map(({ label, value, color }) => (
          <div key={label} className="dashActivityKpi" style={{ borderColor: `${color}35`, background: `linear-gradient(135deg, ${color}18, ${color}06)` }}>
            <div className="dashActivityKpiLabel" style={{ color }}>{label}</div>
            <div className="dashActivityKpiValue">{value}</div>
          </div>
        ))}
        <div className="dashActivityKpi dashActivityKpiTrend">
          <div className="dashActivityKpiLabel">Trend</div>
          <div className="dashActivityTrendRow">
            {trend === 'up' ? <TrendingUp size={18} color={CHART.green} /> : trend === 'neutral' ? <Minus size={18} color={CHART.brand} /> : <TrendingDown size={18} color={CHART.red} />}
            <span style={{ color: trend === 'up' ? CHART.green : trend === 'neutral' ? CHART.brand : CHART.red }}>
              {trend === 'up' ? 'On track' : trend === 'neutral' ? 'Moderate' : 'Behind'}
            </span>
          </div>
        </div>
      </div>
      <ChartShell height={220}>
        {(w) => (
          <ComposedChart width={w} height={220} data={formatted} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="actCreated" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART.brand} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="actCompleted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.green} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART.green} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={CHART.axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={CHART.axis} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
            <Tooltip content={<GlassTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
            <Area type="monotone" dataKey="created" name="Created" fill="url(#actCreated)" stroke={CHART.brand} strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="completed" name="Completed" fill="url(#actCompleted)" stroke={CHART.green} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="overdue" name="Overdue" stroke={CHART.red} strokeWidth={2} dot={false} strokeDasharray="5 3" />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
          </ComposedChart>
        )}
      </ChartShell>
    </div>
  )
}

export function DashboardStatusChart(props: {
  byStatus: Record<string, number>
  loading?: boolean
}) {
  return <StatusDonutChart byStatus={props.byStatus} loading={props.loading} />
}

export function tasksToByStatus(tasks?: {
  pending?: number
  in_progress?: number
  submitted?: number
  completed?: number
  overdue?: number
  cancelled?: number
}) {
  if (!tasks) return {}
  return {
    pending: tasks.pending || 0,
    in_progress: tasks.in_progress || 0,
    submitted: tasks.submitted || 0,
    completed: tasks.completed || 0,
    overdue: tasks.overdue || 0,
    cancelled: tasks.cancelled || 0,
  }
}

export function DashboardVelocityChart(props: {
  data: Array<{ week: string; created: number; completed: number; label?: string }>
  loading?: boolean
}) {
  const data = (props.data || []).map(d => ({
    week: String(d.label || d.week || '').slice(0, 10),
    Created: d.created,
    Completed: d.completed,
  }))
  if (!data.length) return <div className="chartEmptyState">No velocity data yet</div>

  const totalCreated = data.reduce((s, d) => s + d.Created, 0)
  const totalDone = data.reduce((s, d) => s + d.Completed, 0)
  const avgCreated = Math.round(totalCreated / data.length)
  const avgDone = Math.round(totalDone / data.length)
  const last = data[data.length - 1]
  const net = (last?.Completed || 0) - (last?.Created || 0)
  const h = 240

  return (
    <div>
      <div className="dashVelocityMeta">
        <span><i style={{ background: CHART.brand }} /> avg {avgCreated}/wk created</span>
        <span><i style={{ background: CHART.green }} /> avg {avgDone}/wk completed</span>
        <span className={net >= 0 ? 'dashVelocityNetPos' : 'dashVelocityNetNeg'}>
          {net >= 0 ? '▲' : '▼'} Net {Math.abs(net)} this week
        </span>
      </div>
      <ChartShell height={h} loading={props.loading}>
        {(w) => (
          <BarChart width={w} height={h} data={data} margin={{ top: 12, right: 8, left: -8, bottom: 28 }} barGap={4}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="week" tick={CHART.axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={CHART.axis} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }} />
            <Bar dataKey="Created" fill={CHART.brand} radius={[6, 6, 2, 2]} maxBarSize={36} />
            <Bar dataKey="Completed" fill={CHART.green} radius={[6, 6, 2, 2]} maxBarSize={36} />
          </BarChart>
        )}
      </ChartShell>
    </div>
  )
}

export function DashboardProjectProgressChart(props: {
  projects: Array<{
    id: string
    name: string
    color?: string | null
    total: number
    completed: number
    overdue: number
    in_progress: number
    pending: number
    progress: number
  }>
  limit?: number
}) {
  const rows = (props.projects || []).slice(0, props.limit ?? 8)
  if (!rows.length) return <div className="chartEmptyState">No projects yet</div>
  const palette = [CHART.brand, CHART.purple, CHART.blue, CHART.teal, CHART.orange, CHART.green]

  return (
    <div className="dashProjectGrid">
      {rows.map((p, i) => {
        const color = p.color || palette[i % palette.length]
        const segments = [
          { flex: p.completed, bg: CHART.green },
          { flex: p.in_progress, bg: color, opacity: 0.75 },
          { flex: p.overdue, bg: CHART.red },
          { flex: p.pending, bg: 'var(--border)' },
        ].filter(s => s.flex > 0)
        return (
          <div key={p.id} className="dashProjectRow">
            <div className="dashProjectHead">
              <div className="dashProjectName">
                <span className="dashProjectDot" style={{ background: color }} />
                <span>{p.name}</span>
              </div>
              <div className="dashProjectMeta">
                <span>{p.completed}/{p.total}</span>
                <strong style={{ color: p.progress === 100 ? CHART.green : p.overdue > 0 ? CHART.red : undefined }}>{p.progress}%</strong>
              </div>
            </div>
            <div className="dashProjectBar">
              {segments.map((s, j) => (
                <div key={j} style={{ flex: s.flex, background: s.bg, opacity: s.opacity ?? 1 }} />
              ))}
            </div>
            {p.overdue > 0 && <div className="dashProjectOverdue">{p.overdue} overdue</div>}
          </div>
        )
      })}
    </div>
  )
}

export function DashboardTeamPerformanceChart(props: {
  rows: Array<{ id: string; name: string; total: number; completed: number; completion_rate: number }>
  limit?: number
}) {
  const rows = (props.rows || []).slice(0, props.limit ?? 6)
  if (!rows.length) return <div className="chartEmptyState">No team data yet</div>
  const colors = [CHART.brand, CHART.purple, CHART.blue, CHART.teal, CHART.orange, CHART.green]

  return (
    <div className="dashTeamList">
      {rows.map((u, i) => {
        const rate = u.completion_rate || 0
        const rateColor = rate >= 75 ? CHART.green : rate >= 40 ? CHART.brand : CHART.red
        const color = colors[i % colors.length]
        return (
          <div key={u.id} className="dashTeamRow">
            <div className="dashTeamRank" style={{ color, borderColor: `${color}35`, background: `${color}18` }}>{i + 1}</div>
            <div className="dashTeamBody">
              <div className="dashTeamHead">
                <span>{u.name}</span>
                <span>{u.completed}/{u.total} done</span>
              </div>
              <div className="dashTeamTrack"><div style={{ width: `${rate}%`, background: rateColor }} /></div>
            </div>
            <strong style={{ color: rateColor }}>{rate}%</strong>
          </div>
        )
      })}
    </div>
  )
}

export function DashboardWorkloadChart(props: {
  rows: Array<{ id: string; name: string; total: number; completed: number; overdue?: number }>
  limit?: number
}) {
  const rows = (props.rows || []).slice(0, props.limit ?? 8)
  if (!rows.length) return <div className="chartEmptyState">No workload data</div>
  const palette = [CHART.brand, CHART.purple, CHART.blue, CHART.teal]

  return (
    <div className="dashWorkloadGrid">
      {rows.map((u, i) => {
        const active = Math.max(0, u.total - u.completed - (u.overdue || 0))
        if (u.total === 0) return null
        return (
          <div key={u.id} className="dashWorkloadRow">
            <div className="dashWorkloadHead">
              <span>{u.name.split(' ')[0]}</span>
              <span>{u.total} tasks</span>
            </div>
            <div className="dashProjectBar">
              {u.completed > 0 && <div style={{ flex: u.completed, background: CHART.green }} />}
              {active > 0 && <div style={{ flex: active, background: palette[i % palette.length], opacity: 0.85 }} />}
              {(u.overdue || 0) > 0 && <div style={{ flex: u.overdue, background: CHART.red }} />}
            </div>
            <div className="dashWorkloadLegend">
              <span style={{ color: CHART.green }}>{u.completed} done</span>
              {active > 0 && <span style={{ color: CHART.brand }}>{active} active</span>}
              {(u.overdue || 0) > 0 && <span style={{ color: CHART.red }}>{u.overdue} overdue</span>}
            </div>
          </div>
        )
      })}
      <div className="dashWorkloadKeys">
        {[['Done', CHART.green], ['Active', CHART.brand], ['Overdue', CHART.red]].map(([l, c]) => (
          <span key={l}><i style={{ background: c as string }} />{l}</span>
        ))}
      </div>
    </div>
  )
}

export function DashboardPriorityBars(props: { priority: Record<string, number> }) {
  const entries = [['critical', CHART.red], ['high', CHART.orange], ['medium', CHART.purple], ['low', CHART.blue]]
    .map(([k, c]) => ({ label: k, value: Number(props.priority[k] || 0), color: c as string }))
    .filter(e => e.value > 0)
  if (!entries.length) return <div className="chartEmptyState">No tasks yet</div>
  const max = Math.max(...entries.map(e => e.value))

  return (
    <div className="dashPriorityList">
      {entries.map(e => (
        <div key={e.label} className="dashPriorityRow">
          <div className="dashPriorityHead">
            <span style={{ textTransform: 'capitalize' }}>{e.label}</span>
            <strong style={{ color: e.color }}>{e.value}</strong>
          </div>
          <div className="dashPriorityTrack">
            <div style={{ width: `${(e.value / max) * 100}%`, background: e.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export { STATUS_COLORS, PRIORITY_COLORS, CHART }
