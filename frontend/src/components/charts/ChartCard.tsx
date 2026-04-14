import type { ReactNode } from 'react'

export function ChartCard(props: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  /** Stretch chart area to fill grid row height (dashboard). */
  fillHeight?: boolean
}) {
  const head = (
    <div
      className={props.fillHeight ? 'chartCardHead' : undefined}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'baseline',
        marginBottom: props.fillHeight ? undefined : 12,
        flexWrap: 'wrap',
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>{props.title}</h3>
        {props.subtitle ? <div style={{ color: 'var(--text2)', marginTop: 4 }}>{props.subtitle}</div> : null}
      </div>
      {props.right ? <div>{props.right}</div> : null}
    </div>
  )

  if (!props.fillHeight) {
    return (
      <div className="card">
        {head}
        {props.children}
      </div>
    )
  }

  return (
    <div className="card chartCardFill">
      {head}
      <div className="chartCardBody">{props.children}</div>
    </div>
  )
}
