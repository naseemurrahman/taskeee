import { useMemo } from 'react'
import { useLiveAppMetrics, pct } from '../../lib/hooks/useLiveAppMetrics'
import { KpiMetricGrid, buildLiveInsights, trendPct, trendDir } from './AdvancedVisuals'

/** Lightweight live KPI strip — no heavy Recharts on list pages */
export function PageLiveCharts(props: {
  days?: number
  title?: string
  variant?: 'full' | 'compact'
}) {
  const days = props.days ?? 30
  const m = useLiveAppMetrics(days, { enableDash: false, skipRealtime: false })

  const recentDone = m.trendSeries.slice(-2).reduce((s, p) => s + p.completed, 0)
  const prevDone = m.trendSeries.slice(-4, -2).reduce((s, p) => s + p.completed, 0)

  const topInsight = useMemo(() => {
    const list = buildLiveInsights({
      total: m.total,
      completed: m.completed,
      overdue: m.overdue,
      completionRate: m.completionRate,
      trendSeries: m.trendSeries,
      byStatus: m.byStatus,
      dayOfWeek: m.dayOfWeek,
    })
    return list[0]
  }, [m.total, m.completed, m.overdue, m.completionRate, m.trendSeries, m.byStatus, m.dayOfWeek])

  return (
    <section className="pageLiveCharts pageLiveChartsLite" aria-label={props.title || 'Live metrics'}>
      {props.title && <h3 className="pageLiveChartsTitle">{props.title}</h3>}

      <KpiMetricGrid
        loading={m.loading}
        items={[
          { title: 'Total tasks', value: m.total, sub: `${days}d scope`, trend: pct(m.completed, m.total), trendDir: 'neutral' },
          { title: 'Completed', value: m.completed, sub: `${m.completionRate}%`, trend: trendPct(recentDone, prevDone), trendDir: trendDir(recentDone, prevDone) },
          { title: 'Overdue', value: m.overdue, sub: 'needs action', trend: pct(m.overdue, m.total), trendDir: m.overdue ? 'down' : 'up' },
          { title: 'In progress', value: m.byStatus.in_progress ?? 0, sub: 'active now', trend: 0, trendDir: 'neutral' },
        ]}
      />

      {topInsight && !m.loading && (
        <p className="pageLiveChartsHint">
          <strong>{topInsight.title}</strong> — {topInsight.detail}
        </p>
      )}
    </section>
  )
}
