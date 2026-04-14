import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { Modal } from '../../components/Modal'

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

const ACTIVITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'login', label: 'Employee login' },
  { value: 'user_added', label: 'User added' },
  { value: 'task_created', label: 'Task created' },
  { value: 'task_status_changed', label: 'Task status changed' },
  { value: 'task_priority_changed', label: 'Task priority changed' },
  { value: 'task_time_logged', label: 'Time logged on task' },
  { value: 'task_comment_added', label: 'Task comment / thread' },
  { value: 'profile_updated', label: 'Profile updated' },
  { value: 'profile_avatar_updated', label: 'Profile photo updated' },
  { value: 'project_created', label: 'Project created' },
  { value: 'project_updated', label: 'Project updated' },
  { value: 'password_changed', label: 'Password changed' },
]

export function LogsPage() {
  const me = getUser()
  const canSee = !!me?.role && ['admin', 'hr', 'director'].includes(me.role)
  const [days, setDays] = useState(30)
  const [type, setType] = useState('')
  const [pick, setPick] = useState<ActivityLog | null>(null)

  const q = useQuery({
    queryKey: ['logs', days, type],
    queryFn: () => fetchOrgLogs(days, type),
    enabled: canSee,
  })

  const logs = useMemo(() => q.data?.logs || [], [q.data])

  if (!canSee) {
    return (
      <div className="card">
        <div style={{ fontWeight: 950, letterSpacing: '-0.4px' }}>Logs</div>
        <div style={{ marginTop: 8, color: 'var(--text2)' }}>You don’t have access to organization logs.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Logs</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>
              Organization activity for admins, HR, and directors. Includes logins, tasks, projects, profile changes, and
              security events (e.g. <span style={{ fontWeight: 800 }}>password_changed</span>). <strong>Open a row</strong> for
              full detail.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="label" style={{ margin: 0 }}>
              Days
              <select className="input" style={{ height: 40 }} value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
                <option value={7}>7</option>
                <option value={30}>30</option>
                <option value={90}>90</option>
                <option value={365}>365</option>
              </select>
            </label>
            <label className="label" style={{ margin: 0 }}>
              Event type
              <select className="input logsTypeSelect" value={type} onChange={(e) => setType(e.target.value)}>
                {ACTIVITY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError">Failed to load logs.</div> : null}
        {!q.isLoading && logs.length === 0 ? <div style={{ color: 'var(--text2)' }}>No logs found.</div> : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {logs.map((l) => (
            <button
              key={l.id}
              type="button"
              className="miniCard miniLink"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left' }}
              onClick={() => setPick(l)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{l.activity_type}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {new Date(l.created_at).toLocaleString()} · {l.user_name}{l.user_role ? ` (${l.user_role})` : ''}{l.task_title ? ` · ${l.task_title}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {l.task_status ? <span className="pill pillMuted">{l.task_status}</span> : null}
                <span className="pill">{l.task_id ? 'Task' : 'Org'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Modal title="Activity detail" open={!!pick} wide onClose={() => setPick(null)}>
        {pick ? (
          <div style={{ display: 'grid', gap: 14, fontSize: 13 }}>
            <div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' }}>ACTION</div>
              <div style={{ fontWeight: 950, fontSize: 16, marginTop: 4 }}>{pick.activity_type}</div>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' }}>WHEN</div>
              <div style={{ marginTop: 4 }}>{new Date(pick.created_at).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' }}>ACTOR (WHO DID IT)</div>
              <div style={{ marginTop: 4 }}>
                {pick.user_name}
                {pick.user_role ? ` · ${pick.user_role}` : ''}
              </div>
              <div style={{ color: 'var(--text2)', marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>user_id: {pick.user_id}</div>
            </div>
            {pick.task_id ? (
              <div>
                <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' }}>RELATED TASK</div>
                <div style={{ marginTop: 4 }}>{pick.task_title || 'Task'}</div>
                <div style={{ color: 'var(--text2)', marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                  task_id: {pick.task_id}
                  {pick.task_status ? ` · status ${pick.task_status}` : ''}
                </div>
              </div>
            ) : null}
            <div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em', marginBottom: 6 }}>METADATA</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(0,0,0,0.25)',
                  color: 'var(--text2)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflow: 'auto',
                  maxHeight: 280,
                }}
              >
                {(() => {
                  try {
                    return JSON.stringify(
                      typeof pick.metadata === 'string' ? JSON.parse(pick.metadata) : pick.metadata ?? {},
                      null,
                      2,
                    )
                  } catch {
                    return String(pick.metadata ?? '{}')
                  }
                })()}
              </pre>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>log_id: {pick.id}</div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

