import { useRef, useLayoutEffect, useState, type ReactNode } from 'react'

export function useChartWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const measure = () => setW(ref.current?.offsetWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return w
}

export function ChartPlotSkeleton({ height }: { height: number }) {
  return (
    <div style={{ width: '100%', height, minHeight: height, borderRadius: 12, overflow: 'hidden' }}>
      <div className="skeleton" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export function ChartShell({
  height,
  loading = false,
  children,
}: {
  height: number
  loading?: boolean
  children: (width: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const w = useChartWidth(ref)
  if (loading || w === 0) {
    return (
      <div ref={ref} style={{ width: '100%' }}>
        <ChartPlotSkeleton height={height} />
      </div>
    )
  }
  return (
    <div ref={ref} style={{ width: '100%', height, minHeight: height, overflowX: 'hidden', overflowY: 'visible' }}>
      {children(w)}
    </div>
  )
}

export function GlassTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; fill?: string; dataKey?: string; payload?: Record<string, unknown> }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  const displayLabel = (row?.employee || row?.fullName || label) as string | undefined
  return (
    <div className="chartGlassTooltip">
      {displayLabel && <div className="chartGlassTooltipLabel">{displayLabel}</div>}
      {payload.map((p, i) => (
        <div key={`${p.dataKey}-${i}`} className="chartGlassTooltipRow">
          <span className="chartGlassTooltipSwatch" style={{ background: p.color || p.fill }} />
          <span className="chartGlassTooltipName">{p.name}</span>
          <span className="chartGlassTooltipValue">
            {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}
