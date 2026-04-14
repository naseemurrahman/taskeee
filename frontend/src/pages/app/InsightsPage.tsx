import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { TaskInsightsPanel } from '../../components/tasks/TaskInsightsPanel'

type InsightsResponse = {
  insights?: any
  generatedAt?: string
  timeRange?: string
  taskCount?: number
  fallback?: boolean
  message?: string
}

async function fetchInsights(timeRange: string) {
  const qs = new URLSearchParams({ timeRange })
  return await apiFetch<InsightsResponse>(`/api/v1/insights?${qs.toString()}`)
}

export function InsightsPage() {
  const [timeRange, setTimeRange] = useState('30d')
  const q = useQuery({ queryKey: ['insights', timeRange], queryFn: () => fetchInsights(timeRange), retry: false })

  const meta = useMemo(() => {
    if (!q.data) return null
    return `${q.data.taskCount ?? 0} tasks · ${q.data.fallback ? 'basic analytics' : 'ai insights'}`
  }, [q.data])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Insights</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>AI insights (with graceful fallback when AI service is offline).</div>
          </div>
          <label className="label" style={{ margin: 0 }}>
            Time range
            <select className="input" style={{ height: 40 }} value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="90d">90d</option>
            </select>
          </label>
        </div>
        {meta ? <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>{meta}</div> : null}
      </div>

      <div className="card">
        <TaskInsightsPanel
          loading={q.isLoading}
          error={!!q.isError}
          message={q.data?.message ?? null}
          payload={q.data ?? null}
        />
      </div>
    </div>
  )
}

