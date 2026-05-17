import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export function AnimatedKpiNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const target = value
    const start = prev.current
    const diff = target - start
    if (diff === 0) {
      setDisplay(target)
      return
    }
    const steps = 30
    let step = 0
    const t = setInterval(() => {
      step++
      setDisplay(Math.round(start + (diff * step) / steps))
      if (step >= steps) {
        clearInterval(t)
        prev.current = target
        setDisplay(target)
      }
    }, 16)
    return () => clearInterval(t)
  }, [value])
  return (
    <>
      {display}
      {suffix}
    </>
  )
}

export type KpiCardProps = {
  label: string
  value: number | string
  sub?: string
  color?: string
  icon?: ReactNode
  animate?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function KpiCard({
  label,
  value,
  sub,
  color = 'var(--primary)',
  icon,
  animate = typeof value === 'number',
  onClick,
  className = '',
  style,
}: KpiCardProps) {
  const numeric = typeof value === 'number'
  const cardStyle = { '--kpi-color': color, ...style } as CSSProperties
  const cls = `kpiCard ${className}`.trim()

  const body = (
    <>
      <div className="kpiCardAccent" style={{ background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      {icon && (
        <div className="kpiCardWatermark" style={{ color }}>
          {icon}
        </div>
      )}
      <div className="kpiCardLabel">{label}</div>
      <div className="kpiCardValue">
        {animate && numeric ? <AnimatedKpiNumber value={value} /> : value}
      </div>
      {sub && <div className="kpiCardSub">{sub}</div>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={cls} style={cardStyle} onClick={onClick}>
        {body}
      </button>
    )
  }

  return (
    <div className={cls} style={cardStyle}>
      {body}
    </div>
  )
}

export type KpiStripItem = Omit<KpiCardProps, 'className' | 'style'>

export function KpiStrip({
  items,
  loading,
  skeletonCount = 4,
  className = '',
  style,
}: {
  items: KpiStripItem[]
  loading?: boolean
  skeletonCount?: number
  className?: string
  style?: CSSProperties
}) {
  if (loading) {
    return (
      <div className={`kpiStripStandard dashKpiStrip ${className}`.trim()} style={style}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="kpiCard skeleton" style={{ minHeight: 96 }} />
        ))}
      </div>
    )
  }

  return (
    <div className={`kpiStripStandard dashKpiStrip ${className}`.trim()} style={style}>
      {items.map((item) => (
        <KpiCard key={item.label} {...item} />
      ))}
    </div>
  )
}
