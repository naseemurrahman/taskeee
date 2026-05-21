import type { ReactNode } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { LayoutGrid, TrendingDown, TrendingUp, Trophy, AlertTriangle, LineChart as LineChartIcon } from 'lucide-react'
import { CHART, STATUS_COLORS } from './chartTheme'
import { ChartShell, GlassTooltip } from './ChartShell'

function n(v: unknown) {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

function trendDir(current: number, previous: number): 'up' | 'down' | 'neutral' {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'neutral'
}

function trendPct(current: number, previous: number) {
  if (!previous) return current ? 100 : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** Reference: KPI summary stat cards with trend pills */
export function KpiMetricCard(props: {
  title: string
  value: string | number
  sub?: string
  trend?: number
  trendDir?: 'up' | 'down' | 'neutral'
  loading?: boolean
  menu?: boolean
}) {
  if (props.loading) {
    return (
      <div className="kpiMetricCard">
        <div className="skeleton" style={{ height: 14, width: '55%', borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 36, width: '40%', marginTop: 12, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 10, width: '70%', marginTop: 10, borderRadius: 6 }} />
      </div>
    )
  }
  const dir = props.trendDir || 'neutral'
  const trendVal = props.trend ?? 0
  const trendPositive = dir === 'up'
  const trendNegative = dir === 'down'
  return (
    <div className="kpiMetricCard">
      <div className="kpiMetricCardTop">
        <span className="kpiMetricCardTitle">{props.title}</span>
        {props.menu && <button type="button" className="kpiMetricCardMenu" aria-label="Options">⋯</button>}
      </div>
      <div className="kpiMetricCardValue">{props.value}</div>
      <div className="kpiMetricCardFoot">
        {props.trend !== undefined && (
          <span className={`kpiMetricTrend ${trendPositive ? 'kpiMetricTrendUp' : trendNegative ? 'kpiMetricTrendDown' : 'kpiMetricTrendNeutral'}`}>
            {trendPositive ? '+' : trendNegative ? '' : ''}{trendVal}%
          </span>
        )}
        {props.sub && <span className="kpiMetricCardSub">{props.sub}</span>}
      </div>
    </div>
  )
}

export function KpiMetricGrid(props: {
  items: Array<{
    title: string
    value: string | number
    sub?: string
    trend?: number
    trendDir?: 'up' | 'down' | 'neutral'
  }>
  loading?: boolean
}) {
  return (
    <div className="kpiMetricGrid">
      {props.loading
        ? Array.from({ length: 4 }).map((_, i) => <KpiMetricCard key={i} title="" value="" loading />)
        : props.items.map((item) => <KpiMetricCard key={item.title} {...item} menu />)}
    </div>
  )
}

/** Sparkline area (reference KPI cards bottom) */
export function SparklineArea(props: {
  points: number[]
  color?: string
  height?: number
  loading?: boolean
}) {
  const data = (props.points || []).map((v, i) => ({ i, v: n(v) }))
  if (props.loading || !data.length) {
    return <div className="sparklinePlaceholder" style={{ height: props.height || 56 }} />
  }
  const color = props.color || CHART.green
  const h = props.height || 56
  return (
    <ChartShell height={h}>
      {(w) => (
        <AreaChart width={w} height={h} data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#spark-${color.replace('#', '')})`} dot={false} />
        </AreaChart>
      )}
    </ChartShell>
  )
}

/** Semi-circular gauge + sparkline (reference image 1) */
export function GaugeKpiCard(props: {
  title: string
  valueLabel: string
  pct: number
  minLabel?: string
  maxLabel?: string
  trendPct?: number
  sparkline?: number[]
  color?: string
  loading?: boolean
}) {
  const pct = Math.max(0, Math.min(100, n(props.pct)))
  const color = props.color || CHART.green
  if (props.loading) {
    return (
      <div className="gaugeKpiCard">
        <div className="skeleton" style={{ height: 12, width: '60%' }} />
        <div className="skeleton gaugeKpiSkeleton" />
      </div>
    )
  }
  const r = 72
  const circ = Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div className="gaugeKpiCard">
      <div className="gaugeKpiTitle">{props.title}</div>
      <div className="gaugeKpiBody">
        <svg className="gaugeKpiSvg" viewBox="0 0 200 120" aria-hidden>
          <path d="M 28 100 A 72 72 0 0 1 172 100" fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="14" strokeLinecap="round" />
          <path d="M 28 100 A 72 72 0 0 1 172 100" fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`} style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          <text x="100" y="88" textAnchor="middle" className="gaugeKpiValueText">{props.valueLabel}</text>
          {props.minLabel && <text x="32" y="108" className="gaugeKpiScaleText">{props.minLabel}</text>}
          {props.maxLabel && <text x="168" y="108" textAnchor="end" className="gaugeKpiScaleText">{props.maxLabel}</text>}
        </svg>
        <div className="gaugeKpiMeta">
          <strong style={{ fontSize: 22 }}>{pct}%</strong>
          {props.trendPct !== undefined && (
            <span className={props.trendPct >= 0 ? 'gaugeTrendUp' : 'gaugeTrendDown'}>
              {props.trendPct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {Math.abs(props.trendPct)}%
            </span>
          )}
        </div>
      </div>
      <SparklineArea points={props.sparkline || []} color={color} height={52} />
    </div>
  )
}

/** Weekly day bars (reference dark card) */
export function WeeklyDayBars(props: {
  days: Array<{ label: string; value: number; max?: number }>
  accent?: string
  loading?: boolean
  highlightIndex?: number
}) {
  const max = Math.max(1, ...props.days.map((d) => d.value), ...(props.days.map((d) => d.max || 0)))
  if (props.loading) return <div className="weeklyBarsSkeleton" />
  const accent = props.accent || CHART.brand
  return (
    <div className="weeklyDayBars">
      {props.days.map((d, i) => {
        const h = Math.max(6, (d.value / max) * 100)
        const isHi = props.highlightIndex === i
        return (
          <div key={d.label} className="weeklyDayCol">
            {isHi && d.value > 0 && <span className="weeklyDayBadge">+{Math.round((d.value / max) * 100)}%</span>}
            <div className="weeklyDayTrack">
              <div className="weeklyDayFill" style={{ height: `${h}%`, background: accent, opacity: isHi ? 1 : 0.85 }} />
            </div>
            <span className="weeklyDayLabel">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Multi-ring progress (reference month progress) */
export function MultiRingProgress(props: {
  rings: Array<{ label: string; pct: number; color: string; value?: number }>
  centerValue?: string
  centerSub?: string
  loading?: boolean
}) {
  if (props.loading) return <div className="multiRingSkeleton" />
  const size = 140
  const cx = size / 2
  const cy = size / 2
  const widths = [18, 14, 10]
  const gaps = [6, 5, 4]
  let radius = 58
  return (
    <div className="multiRingWrap">
      <div className="multiRingLegend">
        {props.rings.map((r) => (
          <div key={r.label} className="multiRingLegendRow">
            <span className="multiRingDot" style={{ background: r.color }} />
            <span>{r.label}</span>
            {r.value !== undefined && <strong>{r.value}</strong>}
          </div>
        ))}
      </div>
      <div className="multiRingChart" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {props.rings.map((ring, i) => {
            const r = radius
            const circ = 2 * Math.PI * r
            const dash = (Math.min(100, n(ring.pct)) / 100) * circ
            const el = (
              <circle key={ring.label} cx={cx} cy={cy} r={r} fill="none"
                stroke={ring.color} strokeWidth={widths[i] || 10}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
            )
            radius -= (widths[i] || 10) + (gaps[i] || 4)
            return el
          })}
          <circle cx={cx} cy={cy} r={radius - 4} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={8} />
        </svg>
        <div className="multiRingCenter">
          <div className="multiRingCenterVal">{props.centerValue || '—'}</div>
          {props.centerSub && <div className="multiRingCenterSub">{props.centerSub}</div>}
        </div>
      </div>
    </div>
  )
}

/** Stacked team activity (reference completed vs open) */
export function StackedActivityChart(props: {
  points: Array<{ label: string; completed: number; open: number }>
  loading?: boolean
}) {
  const data = (props.points || []).map((p) => ({
    label: p.label,
    Completed: n(p.completed),
    Open: n(p.open),
  }))
  if (props.loading || !data.length) {
    return <div className="chartEmptyState">No activity buckets yet</div>
  }
  const h = 260
  return (
    <ChartShell height={h} loading={props.loading}>
      {(w) => (
        <BarChart width={w} height={h} data={data} margin={{ top: 12, right: 8, left: -8, bottom: 28 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={CHART.axis} axisLine={false} tickLine={false} />
          <YAxis tick={CHART.axis} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
          <Tooltip content={<GlassTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
          <Bar dataKey="Completed" stackId="a" fill={CHART.indigo} radius={[0, 0, 0, 0]} />
          <Bar dataKey="Open" stackId="a" fill="#c7d2fe" radius={[6, 6, 0, 0]} />
        </BarChart>
      )}
    </ChartShell>
  )
}

/** Horizontal category bars (projects / priorities) */
export function HorizontalCategoryChart(props: {
  rows: Array<{ name: string; value: number; color?: string }>
  loading?: boolean
  highlight?: string
}) {
  const rows = (props.rows || []).filter((r) => r.value > 0).slice(0, 8)
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (props.loading) return <div className="chartPlotSkeleton skeleton" style={{ height: 200 }} />
  if (!rows.length) return <div className="chartEmptyState">No category data</div>
  return (
    <div className="hCategoryChart">
      {rows.map((row, i) => {
        const color = row.color || [CHART.indigo, CHART.blue, CHART.teal, CHART.purple][i % 4]
        const w = Math.max(8, (row.value / max) * 100)
        const hi = props.highlight === row.name
        return (
          <div key={row.name} className="hCategoryRow">
            <div className="hCategoryHead">
              <span>{row.name}</span>
              <strong style={{ color: hi ? color : undefined }}>{row.value}</strong>
            </div>
            <div className="hCategoryTrack">
              <div style={{ width: `${w}%`, background: color, opacity: hi ? 1 : 0.88 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Dual-line monthly progress */
export function DualTrendAreaChart(props: {
  points: Array<{ label: string; created: number; completed: number }>
  loading?: boolean
}) {
  const data = props.points || []
  if (props.loading) return <div className="chartPlotSkeleton skeleton" style={{ height: 220 }} />
  if (!data.length) return <div className="chartEmptyState">No trend data</div>
  const h = 240
  return (
    <ChartShell height={h} loading={props.loading}>
      {(w) => (
        <ComposedChart width={w} height={h} data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="advCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.indigo} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART.indigo} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="advCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.2} />
              <stop offset="100%" stopColor={CHART.blue} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={CHART.axis} axisLine={false} tickLine={false} />
          <YAxis tick={CHART.axis} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
          <Tooltip content={<GlassTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
          <Area type="monotone" dataKey="created" name="Created" stroke={CHART.indigo} fill="url(#advCreated)" strokeWidth={2.5} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke={CHART.blue} fill="url(#advCompleted)" strokeWidth={2.5} />
        </ComposedChart>
      )}
    </ChartShell>
  )
}

/** Efficiency bars by week */
export function EfficiencyBarChart(props: {
  points: Array<{ label: string; efficiency: number }>
  loading?: boolean
}) {
  const data = props.points || []
  if (props.loading || !data.length) return <div className="chartEmptyState">No efficiency series</div>
  const h = 220
  return (
    <ChartShell height={h} loading={props.loading}>
      {(w) => (
        <BarChart width={w} height={h} data={data} margin={{ top: 8, right: 8, left: -8, bottom: 24 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={CHART.axis} axisLine={false} tickLine={false} />
          <YAxis tick={CHART.axis} domain={[0, 120]} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<GlassTooltip />} />
          <Bar dataKey="efficiency" name="Throughput %" radius={[8, 8, 2, 2]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === data.length - 1 ? CHART.indigo : 'rgba(148,163,184,0.35)'} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartShell>
  )
}

/** Productivity by weekday donut */
export function WeekdayProductivityDonut(props: {
  days: Array<{ label: string; rate: number }>
  loading?: boolean
}) {
  const data = (props.days || []).filter((d) => d.rate > 0)
  if (props.loading) return <div className="chartPlotSkeleton skeleton" style={{ height: 200 }} />
  if (!data.length) return <div className="chartEmptyState">No weekday pattern yet</div>
  const colors = [CHART.indigo, CHART.blue, '#93c5fd', '#bfdbfe', '#dbeafe', '#e0e7ff', '#c7d2fe']
  const h = 220
  return (
    <div className="weekdayDonutWrap">
      <ChartShell height={h} loading={props.loading}>
        {(w) => (
          <PieChart width={w} height={h}>
            <Tooltip content={<GlassTooltip />} />
            <Pie data={data} dataKey="rate" nameKey="label" cx={w / 2} cy={h / 2}
              innerRadius={h * 0.28} outerRadius={h * 0.4} paddingAngle={2} strokeWidth={0}>
              {data.map((d, i) => <Cell key={d.label} fill={colors[i % colors.length]} />)}
            </Pie>
          </PieChart>
        )}
      </ChartShell>
      <div className="weekdayDonutLegend">
        {data.map((d, i) => (
          <div key={d.label} className="weekdayDonutLegendRow">
            <span className="multiRingDot" style={{ background: colors[i % colors.length] }} />
            <span>{d.label}</span>
            <strong>{d.rate}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Quick insights from live metrics */
export function QuickInsightsPanel(props: {
  insights: Array<{ icon: 'trophy' | 'warn' | 'trend' | 'alert'; title: string; detail: string }>
  loading?: boolean
}) {
  if (props.loading) {
    return (
      <div className="quickInsights">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="quickInsightRow skeleton" style={{ height: 52, borderRadius: 12 }} />
        ))}
      </div>
    )
  }
  const Icon = ({ type }: { type: string }) => {
    if (type === 'warn' || type === 'alert') return <AlertTriangle size={16} color={CHART.orange} />
    if (type === 'trend') return <LineChartIcon size={16} color={CHART.blue} />
    return <Trophy size={16} color={CHART.green} />
  }
  return (
    <div className="quickInsights">
      {props.insights.map((ins) => (
        <div key={ins.title} className="quickInsightRow">
          <Icon type={ins.icon} />
          <div>
            <div className="quickInsightTitle">{ins.title}</div>
            <div className="quickInsightDetail">{ins.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** KPI Summary section header (reference) */
export function KpiSummarySection(props: { title?: string; sub?: string; live?: boolean; children: ReactNode }) {
  return (
    <section className="kpiSummarySection">
      <div className="kpiSummaryHead">
        <div>
          <div className="kpiSummaryKicker">Live metrics</div>
          <h2 className="kpiSummaryTitle">{props.title || 'KPI Summary'}</h2>
          <p className="kpiSummarySub">{props.sub || 'Real-time overview of task flow, completion health, and operational risk.'}</p>
        </div>
        <div className="kpiSummaryHeadRight">
          {props.live && <span className="dashboardModernLive"><span className="dashboardModernLiveDot" />Live</span>}
          <LayoutGrid size={18} className="kpiSummaryGridIcon" aria-hidden />
        </div>
      </div>
      {props.children}
    </section>
  )
}

export function buildLiveInsights(input: {
  total: number
  completed: number
  overdue: number
  completionRate: number
  trendSeries: Array<{ completed: number; created: number; label: string }>
  byStatus: Record<string, number>
  dayOfWeek: Array<{ label: string; rate: number; completed: number }>
}) {
  const insights: Array<{ icon: 'trophy' | 'warn' | 'trend' | 'alert'; title: string; detail: string }> = []
  const bestDay = [...input.dayOfWeek].sort((a, b) => b.rate - a.rate)[0]
  if (bestDay && bestDay.rate > 0) {
    insights.push({
      icon: 'trophy',
      title: `Best day: ${bestDay.label} (${bestDay.rate}%)`,
      detail: 'Highest completion rate relative to tasks created that day.',
    })
  }
  if (input.overdue > 0) {
    const overduePct = input.total ? Math.round((input.overdue / input.total) * 100) : 0
    insights.push({
      icon: 'warn',
      title: `${input.overdue} overdue tasks (${overduePct}%)`,
      detail: 'Requires immediate attention on the board and reassignment queue.',
    })
  }
  const recent = input.trendSeries.slice(-7)
  const recentCreated = recent.reduce((s, p) => s + p.created, 0)
  const recentDone = recent.reduce((s, p) => s + p.completed, 0)
  const velocityDelta = recentDone - recentCreated
  insights.push({
    icon: 'trend',
    title: velocityDelta >= 0 ? `Net +${velocityDelta} tasks cleared (7d)` : `Backlog grew by ${Math.abs(velocityDelta)} (7d)`,
    detail: 'Compares completed vs created over the last seven trend points.',
  })
  const stuck = n(input.byStatus.overdue) + n(input.byStatus.submitted)
  if (stuck > 0) {
    insights.push({
      icon: 'alert',
      title: `${stuck} tasks in review or overdue`,
      detail: 'Submitted and overdue items are the main delivery bottlenecks.',
    })
  }
  if (!insights.length) {
    insights.push({
      icon: 'trophy',
      title: `Completion rate ${input.completionRate}%`,
      detail: 'Metrics will grow more detailed as your team adds tasks.',
    })
  }
  return insights.slice(0, 5)
}

export { trendDir, trendPct }
