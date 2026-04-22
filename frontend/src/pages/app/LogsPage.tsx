import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { Modal } from '../../components/Modal'
import { Select } from '../../components/ui/Select'

type ActivityLog = {
  id: string
  user_id: string
  user_name: string
  user_role?: string | null
  task_id?: string | null
  task_title?: string | null
  task_status?: string | null
  activity_type: string
  metadata?: unknown
  created_at: string
}

async function fetchOrgLogs(days: number, type: string) {
  const qs = new URLSearchParams({ days: String(days), limit: '300' })
  if (type) qs.set('type', type)
  return await apiFetch<{ logs: ActivityLog[] }>(`/api/v1/activity?${qs.toString()}`)
}

const TYPE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  login:                  { label: 'Login',             icon: '🔐', color: '#22c55e', bg: 'rgba(34,197,94,0.10)'   },
  user_added:             { label: 'User Added',        icon: '👤', color: '#38bdf8', bg: 'rgba(56,189,248,0.10)'  },
  task_created:           { label: 'Task Created',      icon: '✅', color: '#818cf8', bg: 'rgba(129,140,248,0.10)' },
  task_status_changed:    { label: 'Status Changed',    icon: '🔄', color: '#e2ab41', bg: 'rgba(226,171,65,0.10)'  },
  task_priority_changed:  { label: 'Priority Changed',  icon: '⚡', color: '#f97316', bg: 'rgba(249,115,22,0.10)'  },
  task_time_logged:       { label: 'Time Logged',       icon: '⏱️', color: '#a78bfa', bg: 'rgba(167,139,250,0.10)' },
  task_comment_added:     { label: 'Comment Added',     icon: '💬', color: '#60a5fa', bg: 'rgba(96,165,250,0.10)'  },
  profile_updated:        { label: 'Profile Updated',   icon: '✏️', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
  profile_avatar_updated: { label: 'Avatar Updated',    icon: '🖼️', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
  project_created:        { label: 'Project Created',   icon: '📁', color: '#fb923c', bg: 'rgba(251,146,60,0.10)'  },
  project_updated:        { label: 'Project Updated',   icon: '📝', color: '#fb923c', bg: 'rgba(251,146,60,0.10)'  },
  password_changed:       { label: 'Password Changed',  icon: '🔑', color: '#ef4444', bg: 'rgba(239,68,68,0.10)'   },
}

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? { label: type.replace(/_/g, ' '), icon: '📋', color: '#9ca3af', bg: 'rgba(156,163,175,0.10)' }
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const DAY_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last year' },
]

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All events' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label })),
]

export function LogsPage() {
  const me = getUser()
  const canSee = !!me?.role && ['admin', 'hr', 'director'].includes(me.role)
  const [days, setDays] = useState(30)
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState<ActivityLog | null>(null)

  const q = useQuery({
    queryKey: ['logs', days, type],
    queryFn: () => fetchOrgLogs(days, type),
    enabled: canSee,
  })

  const logs = useMemo(() => {
    const all = q.data?.logs || []
    if (!search.trim()) return all
    const s = search.toLowerCase()
    return all.filter(l =>
      l.user_name.toLowerCase().includes(s) ||
      l.activity_type.toLowerCase().includes(s) ||
      (l.task_title || '').toLowerCase().includes(s)
    )
  }, [q.data, search])

  // Stats
  const stats = useMemo(() => {
    const all = q.data?.logs || []
    const today = all.filter(l => {
      const d = new Date(l.created_at)
      const now = new Date()
      return d.toDateString() === now.toDateString()
    })
    const logins = all.filter(l => l.activity_type === 'login')
    const uniqueUsers = new Set(all.map(l => l.user_id)).size
    return { total: all.length, today: today.length, logins: logins.length, uniqueUsers }
  }, [q.data])

  if (!canSee) {
    return (
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div>
            <div className="formCardV3Title">Activity Logs</div>
            <div className="formCardV3Sub">You don't have permission to view organization logs.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Activity Logs
            </div>
            <div className="pageHeaderCardSub">Real-time record of all user actions — logins, tasks, projects, and security events across your organization.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">👁️ User activity</span>
              <span className="pageHeaderCardTag">🔐 Security events</span>
              <span className="pageHeaderCardTag">⚡ Real-time</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: 160 }}>
              <Select
                value={String(days)}
                onChange={v => setDays(parseInt(v, 10))}
                options={DAY_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
              />
            </div>
            <div style={{ width: 180 }}>
              <Select
                value={type}
                onChange={setType}
                options={TYPE_FILTER_OPTIONS}
                searchable
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid4">
        {[
          { label: 'Total events', value: q.isLoading ? '—' : String(stats.total), icon: '📊', color: '#818cf8' },
          { label: 'Today',        value: q.isLoading ? '—' : String(stats.today), icon: '📅', color: '#22c55e' },
          { label: 'Logins',       value: q.isLoading ? '—' : String(stats.logins), icon: '🔐', color: '#38bdf8' },
          { label: 'Active users', value: q.isLoading ? '—' : String(stats.uniqueUsers), icon: '👥', color: '#e2ab41' },
        ].map(s => (
          <div key={s.label} className="miniCard">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="miniLabel">{s.label}</div>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
            </div>
            <div className="miniValue" style={{ color: s.color, fontSize: 28 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Log table */}
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div>
            <div className="formCardV3Title">
              Event Stream
              {logs.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'var(--brandDim)', color: 'var(--brand)', border: '1px solid var(--brandBorder)' }}>
                  {logs.length}
                </span>
              )}
            </div>
            <div className="formCardV3Sub">Click any row for full details</div>
          </div>
          {/* Search */}
          <div style={{ position: 'relative', width: 220 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="input"
              style={{ height: 36, paddingLeft: 34, fontSize: 13, width: '100%' }}
              placeholder="Search user, event…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="employeeTableV3" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Event</th>
                <th>User</th>
                <th>Target</th>
                <th style={{ width: 100, textAlign: 'right' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading events…</td></tr>
              )}
              {q.isError && (
                <tr><td colSpan={4}><div className="alertV4 alertV4Error" style={{ margin: 12 }}>Failed to load logs.</div></td></tr>
              )}
              {!q.isLoading && logs.length === 0 && (
                <tr><td colSpan={4}>
                  <div className="emptyStateV3">
                    <div className="emptyStateV3Icon">📋</div>
                    <div className="emptyStateV3Title">No events found</div>
                    <div className="emptyStateV3Body">Try adjusting the date range or event type filter.</div>
                  </div>
                </td></tr>
              )}
              {logs.map(l => {
                const meta = getTypeMeta(l.activity_type)
                return (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setPick(l)}>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '3px 10px', borderRadius: 999,
                        background: meta.bg, color: meta.color,
                        border: `1px solid ${meta.color}33`,
                        fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                      }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{l.user_name}</div>
                      {l.user_role && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1, textTransform: 'capitalize' }}>{l.user_role}</div>}
                    </td>
                    <td>
                      {l.task_title
                        ? <div style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.task_title}</div>
                        : <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                      }
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>{relativeTime(l.created_at)}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{new Date(l.created_at).toLocaleDateString()}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      <Modal title="Event Detail" open={!!pick} wide onClose={() => setPick(null)}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
      >
        {pick ? (() => {
          const meta = getTypeMeta(pick.activity_type)
          return (
            <div style={{ display: 'grid', gap: 18, fontSize: 13 }}>
              {/* Event badge */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 999,
                background: meta.bg, color: meta.color,
                border: `1px solid ${meta.color}44`,
                fontSize: 14, fontWeight: 900, width: 'fit-content',
              }}>
                {meta.icon} {meta.label}
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  { label: 'Actor', value: `${pick.user_name}${pick.user_role ? ` · ${pick.user_role}` : ''}` },
                  { label: 'Timestamp', value: new Date(pick.created_at).toLocaleString() },
                  ...(pick.task_title ? [{ label: 'Task', value: pick.task_title }] : []),
                  ...(pick.task_status ? [{ label: 'Task Status', value: pick.task_status }] : []),
                ].map(row => (
                  <div key={row.label} style={{ background: 'var(--bg2)', borderRadius: 12, padding: '10px 14px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{row.label}</div>
                    <div style={{ fontWeight: 800, color: 'var(--text)' }}>{row.value}</div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Metadata</div>
                <pre style={{
                  margin: 0, padding: '12px 16px', borderRadius: 12,
                  border: '1px solid var(--border)', background: 'var(--bg2)',
                  color: 'var(--text2)', fontSize: 12, lineHeight: 1.6,
                  overflow: 'auto', maxHeight: 240, fontFamily: 'ui-monospace, monospace',
                }}>
                  {(() => {
                    try {
                      return JSON.stringify(
                        typeof pick.metadata === 'string' ? JSON.parse(pick.metadata) : pick.metadata ?? {},
                        null, 2,
                      )
                    } catch {
                      return String(pick.metadata ?? '{}')
                    }
                  })()}
                </pre>
              </div>

              <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
                log_id: {pick.id} · user_id: {pick.user_id}
              </div>
            </div>
          )
        })() : null}
      </Modal>
    </div>
  )
}
