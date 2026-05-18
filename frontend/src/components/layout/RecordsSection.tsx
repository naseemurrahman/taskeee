import type { ReactNode } from 'react'

export function RecordsSection({ title, actionLabel = 'Open records', children }: { title: string; actionLabel?: string; children: ReactNode }) {
  return (
    <details className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', padding: 16, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontWeight: 950 }}>
        <span>{title}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 800 }}>{actionLabel}</span>
      </summary>
      <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>{children}</div>
    </details>
  )
}
