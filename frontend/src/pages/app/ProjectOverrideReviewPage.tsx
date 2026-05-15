import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui/PageStates'
import { Input } from '../../components/ui/Input'
import { IconClipboard } from '../../components/ui/AppIcons'

type AuditEntry = {
  id: string
  actor_user_id?: string | null
  action?: string | null
  entity_type?: string | null
  entity_id?: string | null
  metadata?: any
  ip?: string | null
  user_agent?: string | null
  created_at?: string | null
  actor_name?: string | null
  actor_role?: string | null
}

function fetchProjectStatusAudit() {
  return apiFetch<{ entries: AuditEntry[] }>('/api/v1/audit?action=project.status.changed&entity=project&days=365&limit=300')
    .then(d => d.entries || [])
}

function parseMeta(raw: any) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ProjectOverrideReviewPage() {
  const me = getUser()
  const role = String(me?.role || '').toLowerCase()
  const allowed = ['admin', 'director'].includes(role)
  const [search, setSearch] = useState('')

  const auditQ = useQuery({
    queryKey: ['audit', 'project-completion-overrides'],
    queryFn: fetchProjectStatusAudit,
    enabled: allowed,
    staleTime: 60_000,
  })

  const overrides = useMemo(() => {
    const rows = auditQ.data || []
    return rows
      .map(entry => ({ entry, meta: parseMeta(entry.metadata) }))
      .filter(({ meta }) => String(meta.newStatus || meta.status || '').toLowerCase() === 'completed')
      .filter(({ meta }) => Number(meta.activeTaskCount || 0) > 0 || meta.override_completion === true || meta.overrideReason || meta.override_reason)
  }, [auditQ.data])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return overrides
    return overrides.filter(({ entry, meta }) => [entry.actor_name, entry.actor_role, entry.entity_id, meta.projectName, meta.reason, meta.overrideReason, meta.override_reason]
      .some(v => String(v || '').toLowerCase().includes(s)))
  }, [overrides, search])

  if (!allowed) {
    return <EmptyState icon={<IconClipboard size={14} />} title="Override review is restricted" sub="Only Admin and Director can review project completion overrides." />
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner" style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/></svg>
              Project Override Review
            </div>
            <div className="pageHeaderCardSub">Audit trail for completed projects that still had active work at completion time.</div>
            <div className="pageHeaderCardMeta"><span className="pageHeaderCardTag">{overrides.length} override records</span></div>
          </div>
          <Link to="/app/audit" className="btn btnGhost" style={{ textDecoration: 'none' }}>Full Audit Log</Link>
        </div>
      </div>

      <div className="chartV3" style={{ padding: 14 }}>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search project, actor, reason, id…" />
      </div>

      <div className="chartV3" style={{ padding: 0, overflow: 'hidden' }}>
        {auditQ.isLoading ? (
          <div style={{ padding: 16 }}><SkeletonRows count={6} /></div>
        ) : auditQ.isError ? (
          <ErrorRetry queryKey={['audit', 'project-completion-overrides']} message="Could not load override audit records." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<IconClipboard size={14} />} title={search ? 'No overrides match your search' : 'No completion overrides found'} sub="Admin/Director project completion overrides with active task counts will appear here." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tasksTable" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="thCell">Project</th>
                  <th className="thCell">Actor</th>
                  <th className="thCell">Active tasks</th>
                  <th className="thCell">Reason</th>
                  <th className="thCell">When</th>
                  <th className="thCell">IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ entry, meta }) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 850 }}>{meta.projectName || entry.entity_id || 'Project'}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{entry.entity_id}</div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 800 }}>{entry.actor_name || entry.actor_user_id || 'Unknown actor'}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'capitalize' }}>{entry.actor_role || '—'}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: 850, color: '#f59e0b' }}>{Number(meta.activeTaskCount || 0)}</td>
                    <td style={{ padding: '12px 14px', maxWidth: 360 }}>
                      <div style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>{meta.override_reason || meta.overrideReason || meta.reason || 'No override reason captured in metadata'}</div>
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{fmtDate(entry.created_at)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--muted)', fontSize: 12 }}>{entry.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
