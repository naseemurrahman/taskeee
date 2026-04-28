import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { ChartCard } from '../../components/charts/ChartCard'

type Insight = {
  id: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  recommendation: string
}

type InsightsResponse = {
  generated_at: string
  insights: Insight[]
}

async function fetchInsights(days: number) {
  return apiFetch<InsightsResponse>(`/api/v1/insights/overview?days=${days}`)
}

function severityColor(severity: Insight['severity']) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'high') return '#f97316'
  if (severity === 'medium') return '#f4ca57'
  return '#22c55e'
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30)

  const insightsQ = useQuery({
    queryKey: ['insights', days],
    queryFn: () => fetchInsights(days),
  })

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">AI Analytics</div>
            <div className="pageHeaderCardSub">
              Smart operational insights generated from live task data.
            </div>
          </div>

          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            style={{
              height: 38,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg2)',
              color: 'var(--text)',
              padding: '0 10px',
              fontWeight: 700,
            }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <ChartCard
        title="AI Insights"
        subtitle="Prioritized risks and recommendations from the new insights engine."
      >
        {insightsQ.isLoading ? (
          <div style={{ color: 'var(--text2)' }}>Loading insights…</div>
        ) : null}

        {insightsQ.isError ? (
          <div className="alertV4 alertV4Error">Failed to load AI insights.</div>
        ) : null}

        {!insightsQ.isLoading &&
        !insightsQ.isError &&
        (insightsQ.data?.insights.length || 0) === 0 ? (
          <div style={{ color: 'var(--text2)' }}>No major risks detected.</div>
        ) : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {(insightsQ.data?.insights || []).map((insight) => {
            const color = severityColor(insight.severity)

            return (
              <div
                key={insight.id}
                className="miniCard"
                style={{
                  borderLeft: `4px solid ${color}`,
                  background: `${color}14`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{insight.title}</div>
                  <span className="pill pillMuted" style={{ color }}>
                    {insight.severity.toUpperCase()}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    color: 'var(--text2)',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {insight.description}
                </div>

                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 750 }}>
                  Recommendation: {insight.recommendation}
                </div>
              </div>
            )
          })}
        </div>
      </ChartCard>
    </div>
  )
}
