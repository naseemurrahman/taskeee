import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { Select } from '../../components/ui/Select'

type AuditEntry = {
  id: string
  actor_user_id?: string | null
  actor_name?: string | null
  actor_role?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
  user_agent?: string | null
  created_at: string
}

async function fetchAudit(days: number, action: string, entity: string) {
  const qs = new URLSearchParams({ days: String(days), limit: '200' })
  if (action.trim()) qs.set('action', action.trim())
  if (entity.trim()) qs.set('entity', entity.trim())
  return await apiFetch<{ entries: AuditEntry[] }>(`/api/v1/audit?${qs.toString()}`)
}

function summarizeMeta(meta: unknown) {
  if (meta == null || typeof meta !== 'object') return '—'
  const keys = Object.keys(meta as object)
  if (!keys.length) return '—'
  return keys.slice(0, 4).join(', ')
}

export function AuditPage() {
  const [days, setDays] = useState(30)
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const q = useQuery({ queryKey: ['audit', days, action, entity], queryFn: () => fetchAudit(days, action, entity) })

  const entries = useMemo(() => q.data?.entries || [], [q.data])

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Audit Log
            </div>
            <div className="pageHeaderCardSub">Full audit trail of all actions in your organization — who did what, when, and from which IP address. Use filters to find specific events.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🔍</span> Action history</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🔒</span> Security events</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📍</span> IP address tracking</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 150 }}>
              <Select value={String(days)} onChange={v => setDays(parseInt(v, 10))}
                options={[
                  { value: '7', label: 'Last 7 days' },
                  { value: '30', label: 'Last 30 days' },
                  { value: '90', label: 'Last 90 days' },
                ]}
              />
            </div>
            <input style={{ height: 40, padding: "0 12px", borderRadius: 999, border: "1.5px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" as const }} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action…" />
            <input style={{ height: 40, padding: "0 12px", borderRadius: 999, border: "1.5px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" as const }} value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Filter by entity…" />
          </div>
        </div>
      </div>
      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alertV4 alertV4Error">Failed to load audit trail.</div> : null}
        {!q.isLoading && entries.length === 0 ? (
          <div className="emptyStateV3">
            <div className="emptyStateV3Icon">🔍</div>
            <div className="emptyStateV3Title">No audit entries in this range</div>
            <div className="emptyStateV3Body">Sensitive actions are logged here as they occur. For day-to-day task history, use <Link to="/app/logs" style={{ color: 'var(--brand)', fontWeight: 800 }}>Logs</Link>.</div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 10, marginTop: q.isLoading ? 12 : 0 }}>
          {entries.map((e) => (
            <div key={e.id} className="miniCard" style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{e.action}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(e.created_at).toLocaleString()}</div>
              </div>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                <span className="pill pillMuted">{e.entity_type}</span>
                {e.entity_id ? (
                  <span className="pill" style={{ marginLeft: 6 }}>
                    {e.entity_id.length > 12 ? `${e.entity_id.slice(0, 8)}…` : e.entity_id}
                  </span>
                ) : null}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Actor: {e.actor_name || '—'}
                {e.actor_role ? ` (${e.actor_role})` : ''}
                {e.ip ? ` · IP ${e.ip}` : ''}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Metadata keys: {summarizeMeta(e.metadata)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
