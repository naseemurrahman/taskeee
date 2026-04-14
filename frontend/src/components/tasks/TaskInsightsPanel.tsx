import type { ReactNode } from 'react'

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontWeight: 950, fontSize: 13, letterSpacing: '0.02em', marginBottom: 10 }}>{props.title}</div>
      {props.children}
    </div>
  )
}

function Muted(props: { children: ReactNode }) {
  return <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.55 }}>{props.children}</div>
}

function KeyValueTable(props: { rows: Array<[string, string]> }) {
  if (!props.rows.length) return null
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      {props.rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ color: 'var(--muted)', fontWeight: 800, minWidth: 120 }}>{k}</span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function renderRecommendations(rec: unknown): ReactNode {
  const list = Array.isArray(rec) ? rec : []
  if (list.length === 0) return <Muted>No recommendations yet. Add more completed tasks to unlock suggestions.</Muted>
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>
      {list.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {typeof item === 'string' ? item : JSON.stringify(item)}
        </li>
      ))}
    </ul>
  )
}

/** Turns API “insights” payloads into readable dashboard copy (no raw JSON). */
export function TaskInsightsPanel(props: {
  loading?: boolean
  error?: boolean
  message?: string | null
  payload: unknown
}) {
  if (props.loading) return <div style={{ color: 'var(--text2)' }}>Generating insights…</div>
  if (props.error) return <div style={{ color: 'var(--text2)' }}>Insights are temporarily unavailable.</div>

  const root =
    props.payload && typeof props.payload === 'object' && props.payload !== null && 'insights' in (props.payload as object)
      ? (props.payload as { insights?: unknown }).insights
      : props.payload

  if (props.message) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="pill pillMuted">{props.message}</div>
        {root && typeof root === 'object' ? <TaskInsightsPanel payload={root} /> : null}
      </div>
    )
  }

  if (root == null || (typeof root === 'object' && root !== null && Object.keys(root as object).length === 0)) {
    return <Muted>No insight data for this range yet.</Muted>
  }

  if (typeof root !== 'object' || root === null) {
    return <Muted>{String(root)}</Muted>
  }

  const o = root as Record<string, unknown>
  const productivity = o.productivity
  const bottlenecks = o.bottlenecks
  const predictions = o.predictions
  const recommendations = o.recommendations

  const prodMsg =
    productivity && typeof productivity === 'object' && productivity !== null && 'message' in productivity
      ? String((productivity as { message?: unknown }).message || '')
      : typeof productivity === 'string'
        ? productivity
        : ''

  const predMsg =
    predictions && typeof predictions === 'object' && predictions !== null && 'message' in predictions
      ? String((predictions as { message?: unknown }).message || '')
      : typeof predictions === 'string'
        ? predictions
        : ''

  const bottleneckRows: Array<[string, string]> = []
  let bottleneckHeadline = ''
  if (bottlenecks && typeof bottlenecks === 'object' && bottlenecks !== null) {
    const b = bottlenecks as Record<string, unknown>
    if (typeof b.bottleneck_status === 'string') bottleneckHeadline = b.bottleneck_status
    const dist = b.status_distribution
    if (dist && typeof dist === 'object' && dist !== null) {
      for (const [k, v] of Object.entries(dist as Record<string, unknown>)) {
        bottleneckRows.push([k, String(v)])
      }
    }
    const high = b.high_priority_stuck
    if (Array.isArray(high) && high.length > 0) {
      bottleneckRows.push(['High priority stuck', String(high.length)])
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Section title="Productivity">
        {prodMsg ? <Muted>{prodMsg}</Muted> : <Muted>No productivity summary returned.</Muted>}
      </Section>

      <Section title="Bottlenecks & flow">
        {bottleneckHeadline ? (
          <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6, color: 'var(--primary)' }}>Focus: {bottleneckHeadline}</div>
        ) : null}
        {bottleneckRows.length > 0 ? (
          <>
            <Muted>Tasks grouped by status in this window:</Muted>
            <KeyValueTable rows={bottleneckRows} />
          </>
        ) : (
          <Muted>No bottleneck signals detected (or not enough tasks).</Muted>
        )}
      </Section>

      <Section title="Forecasts">
        {predMsg ? <Muted>{predMsg}</Muted> : <Muted>No prediction data yet.</Muted>}
      </Section>

      <Section title="Recommendations">{renderRecommendations(recommendations)}</Section>
    </div>
  )
}
