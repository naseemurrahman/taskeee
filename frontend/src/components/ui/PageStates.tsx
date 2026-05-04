import { useQueryClient } from '@tanstack/react-query'

/* ─── Skeleton loader ────────────────────────────────────────── */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeletonRow" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeletonCard" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}

export function SkeletonKpi({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ flex: '1 1 120px', height: 80, borderRadius: 14 }} />
      ))}
    </div>
  )
}

/* ─── Error retry ────────────────────────────────────────────── */
export function ErrorRetry({
  message = 'Something went wrong.',
  queryKey,
  onRetry,
}: {
  message?: string
  queryKey?: unknown[]
  onRetry?: () => void
}) {
  const qc = useQueryClient()
  function handleRetry() {
    if (onRetry) { onRetry(); return }
    if (queryKey) qc.invalidateQueries({ queryKey })
  }
  return (
    <div className="errorRetryCard">
      <div className="errorIcon">⚠️</div>
      <div className="errorTitle">Failed to load</div>
      <div className="errorSub">{message}</div>
      <button className="btn btnPrimary" onClick={handleRetry} style={{ marginTop: 4, height: 36, padding: '0 20px', fontSize: 13 }}>
        Try again
      </button>
    </div>
  )
}

/* ─── Empty state ────────────────────────────────────────────── */
export function EmptyState({
  icon = '📭',
  title,
  sub,
  action,
}: {
  icon?: string
  title: string
  sub?: string
  action?: React.ReactNode
}) {
  return (
    <div className="emptyStateCard">
      <div className="emptyIcon">{icon}</div>
      <div className="emptyTitle">{title}</div>
      {sub && <div className="emptySub">{sub}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}

/* ─── Pull-to-refresh hook ───────────────────────────────────── */
export function usePullToRefresh(onRefresh: () => void) {
  const startY = { current: 0 }
  const pulling = { current: false }

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY
    pulling.current = window.scrollY === 0
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!pulling.current) return
    const deltaY = e.changedTouches[0].clientY - startY.current
    if (deltaY > 60) onRefresh()
    pulling.current = false
  }

  return { onTouchStart, onTouchEnd }
}
