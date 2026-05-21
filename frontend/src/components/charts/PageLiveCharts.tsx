import { useMemo } from 'react'
import { useLiveAppMetrics, pct } from '../../lib/hooks/useLiveAppMetrics'
import { ChartCard } from './ChartCard'
import {
  KpiMetricGrid, WeeklyDayBars, DualTrendAreaChart, StatusDonutChart,
  QuickInsightsPanel, buildLiveInsights, trendPct, trendDir,
} from './AdvancedVisuals'
import { CHART } from './chartTheme'

/** Compact live chart strip for Tasks, Board, Projects, Team, etc. */
export function PageLiveCharts(props: {
  days?: number
  title?: string
  variant?: 'full' | 'compact'
}) {
  const days = props.days ?? 30
  const compact = props.variant === 'compact'
  const m = useLiveAppMetrics(days, { enableDash: !compact })

  const weeklyBars = useMemo(
    () => m.trendSeries.slice(-7).map((p, i) => ({
      label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i % 7],
      value: p.completed,
    })),
    [m.trendSeries],
  )

  const insights = useMemo(
    () => buildLiveInsights({
      total: m.total,
      completed: m.completed,
      overdue: m.overdue,
      completionRate: m.completionRate,
      trendSeries: m.trendSeries,
      byStatus: m.byStatus,
      dayOfWeek: m.dayOfWeek,
    }).slice(0, compact ? 3 : 4),
    [m, compact],
  )

  const recentDone = m.trendSeries.slice(-2).reduce((s, p) => s + p.completed, 0)
  const prevDone = m.trendSeries.slice(-4, -2).reduce((s, p) => s + p.completed, 0)

  return (
    <section className="pageLiveCharts" aria-label={props.title || 'Live metrics'}>
      {props.title && <h3 className="pageLiveChartsTitle">{props.title}</h3>}

      <KpiMetricGrid
        loading={m.loading}
        items={[
          { title: 'Total tasks', value: m.total, sub: 'live scope', trend: pct(m.completed, m.total), trendDir: 'neutral' },
          { title: 'Completed', value: m.completed, sub: `${m.completionRate}%`, trend: trendPct(recentDone, prevDone), trendDir: trendDir(recentDone, prevDone) },
          { title: 'Overdue', value: m.overdue, sub: 'action needed', trend: pct(m.overdue, m.total), trendDir: m.overdue ? 'down' : 'up' },
          { title: 'In progress', value: m.byStatus.in_progress || 0, sub: 'active', trend: 0, trendDir: 'neutral' },
        ]}
      />

      <div className={compact ? 'pageLiveChartsCompactGrid' : 'analyticsHeroRow'}>
        <ChartCard title="Live trend" subtitle="Created vs completed" loading={m.loading}>
          <DualTrendAreaChart points={m.trendSeries} loading={m.loading} />
        </ChartCard>
        {!compact && (
          <ChartCard title="Status mix" subtitle="Real-time" loading={m.loading}>
            <StatusDonutChart byStatus={m.byStatus} loading={m.loading} />
          </ChartCard>
        )}
      </div>

      <div className="pageLiveChartsRow">
        <ChartCard title="This week" subtitle="Daily completions" loading={m.loading}>
          <WeeklyDayBars days={weeklyBars} accent={CHART.brand} loading={m.loading} />
        </ChartCard>
        <ChartCard title="Insights" subtitle="From live data" loading={m.loading}>
          <QuickInsightsPanel insights={insights} loading={m.loading} />
        </ChartCard>
      </div>
    </section>
  )
}
