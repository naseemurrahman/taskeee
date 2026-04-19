import type { ReactNode } from 'react'

export function ChartCard(props: {
  title: string
  subtitle?: string
  right?: ReactNode
  badge?: { value: string | number; positive?: boolean; neutral?: boolean }
  icon?: ReactNode
  children: ReactNode
  fillHeight?: boolean
  noPad?: boolean
}) {
  return (
    <div className="chartCardV2">
      <div className="chartCardV2Head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {props.icon && (
            <div className="chartCardV2Icon">{props.icon}</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="chartCardV2Title">{props.title}</div>
            {props.subtitle && (
              <div className="chartCardV2Sub">{props.subtitle}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {props.badge && (
            <span className={`trendBadge ${props.badge.positive ? 'trendPos' : props.badge.neutral ? 'trendNeutral' : 'trendNeg'}`}>
              {props.badge.positive ? '↑' : props.badge.neutral ? '→' : '↓'} {props.badge.value}
            </span>
          )}
          {props.right}
        </div>
      </div>
      <div className={props.noPad ? '' : 'chartCardV2Body'}>
        {props.children}
      </div>
    </div>
  )
}
