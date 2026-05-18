import type { ReactNode } from 'react'

export function numberValue(value: unknown) {
  return Number(value || 0)
}

export function percent(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0
}

export function AnalyticsCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0, overflow: 'hidden' }}>
      <div>
        <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 950 }}>{title}</div>
        {subtitle ? <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 750, marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function EmptyAnalyticsState({ title, detail = 'No live analytics for the selected period.', minHeight = 118 }: { title: string; detail?: string; minHeight?: number }) {
  return (
    <div style={{ minHeight, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 900 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 11 }}>{detail}</div>
      </div>
    </div>
  )
}

export function AnalyticsLoadingBlock({ height = 165 }: { height?: number }) {
  return <div className="skeleton" style={{ height, borderRadius: 14 }} />
}

export function AnalyticsErrorNotice({ message = 'Live analytics failed to load. This panel will retry automatically.' }: { message?: string }) {
  return <div className="alertV4 alertV4Error">{message}</div>
}

export type RiskQueueItem = {
  task_id?: string
  title?: string
  risk_score?: number
  risk_reason?: string
  assigned_to_name?: string | null
  due_date?: string | null
}

export function AnalyticsRiskQueue({
  tasks,
  emptyTitle = 'No SLA risk queue',
  emptyDetail = 'No overdue, due-soon, stalled, critical, or review-backlog tasks.',
  limit = 6,
}: {
  tasks?: RiskQueueItem[]
  emptyTitle?: string
  emptyDetail?: string
  limit?: number
}) {
  if (!tasks?.length) return <EmptyAnalyticsState title={emptyTitle} detail={emptyDetail} />
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {tasks.slice(0, limit).map((task) => {
        const score = numberValue(task.risk_score)
        const color = score >= 80 ? '#ef4444' : score >= 50 ? '#f97316' : '#e2ab41'
        return (
          <div key={task.task_id || task.title} className="miniCard" style={{ borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || 'Untitled task'}</strong>
              <span className="pill pillMuted" style={{ color }}>{score}</span>
            </div>
            <div style={{ marginTop: 5, color: 'var(--text2)', fontSize: 12, lineHeight: 1.45 }}>
              {task.risk_reason || 'Operational risk signal'}{task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}{task.due_date ? ` · due ${new Date(task.due_date).toLocaleDateString()}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export type TrendSeriesPoint = Record<string, string | number | undefined | null>

export function AnalyticsTrendLineChart({
  points,
  keys,
  labels,
  colors,
  emptyTitle = 'No trend movement',
  emptyDetail = 'Movement will appear here when records change.',
  height = 210,
  ariaLabel = 'Live analytics trend',
}: {
  points: TrendSeriesPoint[]
  keys: string[]
  labels: Record<string, string>
  colors: Record<string, string>
  emptyTitle?: string
  emptyDetail?: string
  height?: number
  ariaLabel?: string
}) {
  const rows = points.map((point) => {
    const dayRaw = String(point.day || '')
    const row: Record<string, string | number> = { day: dayRaw.includes('-') ? dayRaw.slice(5, 10) : dayRaw }
    for (const key of keys) row[key] = numberValue(point[key])
    return row
  })
  const total = rows.reduce((sum, row) => sum + keys.reduce((inner, key) => inner + numberValue(row[key]), 0), 0)
  if (!rows.length || total === 0) return <EmptyAnalyticsState title={emptyTitle} detail={emptyDetail} />

  const W = 720, H = height, L = 34, R = 14, T = 14, B = 32
  const max = Math.max(1, ...rows.flatMap((row) => keys.map((key) => numberValue(row[key]))))
  const x = (i: number) => L + i * (W - L - R) / Math.max(1, rows.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const path = (key: string) => rows.map((row, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(numberValue(row[key]))}`).join(' ')
  const tickEvery = Math.max(1, Math.ceil(rows.length / 6))

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label={ariaLabel}>
        {[0, .25, .5, .75, 1].map((tick) => {
          const yy = T + tick * (H - T - B)
          return <line key={tick} x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(148,163,184,.16)" strokeDasharray="4 4" />
        })}
        {keys.map((key, index) => (
          <path key={key} d={path(key)} fill="none" stroke={colors[key] || '#e2ab41'} strokeWidth="3" strokeDasharray={index === 2 ? '6 4' : undefined} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {rows.map((row, i) => i % tickEvery === 0 || i === rows.length - 1 ? <text key={`${row.day}-${i}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--muted)">{row.day}</text> : null)}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', fontSize: 11, fontWeight: 800 }}>
        {keys.map((key) => <span key={key} style={{ color: colors[key] || '#e2ab41' }}>● {labels[key] || key}</span>)}
      </div>
    </div>
  )
}
