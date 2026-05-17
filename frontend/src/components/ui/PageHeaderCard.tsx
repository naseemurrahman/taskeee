import type { ReactNode } from 'react'

/**
 * PageHeaderCard - Standardized header card matching dashboard design
 */

export interface PageHeaderCardProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  badges?: Array<{ label: string; color?: string; icon?: ReactNode }>
  actions?: ReactNode
  className?: string
  style?: React.CSSProperties
}

export function PageHeaderCard({
  icon,
  title,
  subtitle,
  badges,
  actions,
  className,
  style,
}: PageHeaderCardProps) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        display: 'grid',
        gap: 12,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {icon && (
            <div style={{ flexShrink: 0, color: 'var(--text2)', display: 'flex', alignItems: 'center' }}>
              {icon}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text)',
              margin: 0,
              letterSpacing: '-0.015em',
              lineHeight: 1.3,
            }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{
                fontSize: 13,
                color: 'var(--muted)',
                margin: '4px 0 0 0',
                lineHeight: 1.5,
              }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div style={{ flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>

      {badges && badges.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {badges.map((badge, i) => (
            <div
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 26,
                padding: '0 12px',
                borderRadius: 999,
                background: badge.color ? `${badge.color}18` : 'var(--bg2)',
                border: `1px solid ${badge.color ? `${badge.color}40` : 'var(--border)'}`,
                color: badge.color || 'var(--text2)',
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
            >
              {badge.icon}
              {badge.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export interface StatCard {
  icon?: ReactNode
  label: string
  value: string | number
  subtitle?: string
  color?: string
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' }
}

export function StatsCardGrid({ stats, columns = 4 }: { stats: StatCard[]; columns?: number }) {
  return (
    <div
      className="kpiStripStandard"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${columns === 6 ? '160px' : columns === 4 ? '200px' : '240px'}), 1fr))`,
        gap: 12,
      }}
    >
      {stats.map((stat, i) => (
        <div
          key={i}
          className="kpiCard"
          style={{ '--kpi-color': stat.color || 'var(--primary)' } as React.CSSProperties}
        >
          <div
            className="kpiCardAccent"
            style={{ background: `linear-gradient(90deg, ${stat.color || 'var(--primary)'}, ${stat.color || 'var(--primary)'}88)` }}
          />
          {stat.icon && (
            <div className="kpiCardWatermark" style={{ color: stat.color || 'var(--muted)' }}>
              {stat.icon}
            </div>
          )}
          <div className="kpiCardLabel">{stat.label}</div>
          <div className="kpiCardValue" style={stat.color ? { color: stat.color } : undefined}>
            {stat.value}
            {stat.trend && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                marginLeft: 8,
                color: stat.trend.direction === 'up' ? '#22c55e' : stat.trend.direction === 'down' ? '#ef4444' : 'var(--muted)',
              }}>
                {stat.trend.direction === 'up' ? '↑' : stat.trend.direction === 'down' ? '↓' : '→'} {stat.trend.value}
              </span>
            )}
          </div>
          {stat.subtitle && <div className="kpiCardSub">{stat.subtitle}</div>}
        </div>
      ))}
    </div>
  )
}
