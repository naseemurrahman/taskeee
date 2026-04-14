export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />
}

export function SkeletonText({ className = '', lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={className}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton skeletonText"
          style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`skeletonCard ${className}`}>
      <div className="skeleton skeletonTitle" />
      <SkeletonText lines={3} />
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <div className="skeleton skeletonButton" />
        <div className="skeleton skeletonButton" />
      </div>
    </div>
  )
}

export function SkeletonMiniCard({ className = '' }: { className?: string }) {
  return <div className={`skeletonMiniCard ${className}`} />
}

export function SkeletonChart({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeletonChart ${className}`} style={style} />
}

export function SkeletonAvatar({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`skeleton skeletonAvatar ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function DashboardSkeleton() {
  return (
    <div className="dashGrid">
      <div className="dashMainCol" style={{ display: 'grid', gap: 14 }}>
        <div className="card">
          <div className="grid4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeletonMiniCard" />
            ))}
          </div>
          <div className="grid4" style={{ marginTop: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="skeletonMiniCard" />
            ))}
          </div>
        </div>

        <div className="card">
          <SkeletonText lines={2} />
          <div className="grid4" style={{ marginTop: 12 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeletonMiniCard" />
            ))}
          </div>
        </div>

        <div className="dashFocusRow">
          {[1, 2].map((i) => (
            <div key={i} className="card">
              <SkeletonText lines={2} />
              <div style={{ marginTop: 12 }}>
                {[1, 2, 3].map((j) => (
                  <div key={j} className="skeleton skeletonMiniCard" style={{ marginBottom: 8, height: 60 }} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid2">
          <div className="card">
            <SkeletonText lines={2} />
            <SkeletonChart style={{ marginTop: 12 }} />
          </div>
          <div className="card">
            <SkeletonText lines={2} />
            <SkeletonChart style={{ marginTop: 12 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
