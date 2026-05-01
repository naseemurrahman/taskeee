import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: string | ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon = '📭', title, subtitle, action, compact = false }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: compact ? 10 : 16,
      padding: compact ? '28px 16px' : '56px 24px',
      textAlign: 'center',
    }}>
      <div style={{
        width: compact ? 48 : 64,
        height: compact ? 48 : 64,
        borderRadius: compact ? 14 : 20,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'grid',
        placeItems: 'center',
        fontSize: compact ? 20 : 28,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{
          fontSize: compact ? 14 : 16,
          fontWeight: 750,
          color: 'var(--text)',
          marginBottom: 6,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: compact ? 12 : 13,
            color: 'var(--text2)',
            maxWidth: 300,
            lineHeight: 1.6,
            margin: '0 auto',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && <div style={{ marginTop: compact ? 4 : 8 }}>{action}</div>}
    </div>
  )
}
