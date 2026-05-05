import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser, getAccessToken } from '../../state/auth'

type TestResult = { ok?: boolean; skipped?: string; error?: string; status?: number; [key: string]: any }

function StatusPill({ ok }: { ok?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999,
      fontSize: 11, fontWeight: 900,
      background: ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
      color: ok ? '#22c55e' : '#ef4444',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`
    }}>
      {ok ? '✓ OK' : '✗ Issue'}
    </span>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: 18 }}>
      <div style={{ fontWeight: 950, color: 'var(--text)', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

export function DiagnosticsPage() {
  const me = getUser()
  const token = getAccessToken()
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [running, setRunning] = useState(false)
  const [testEmail, setTestEmail] = useState(me?.email || '')
  const [testPhone, setTestPhone] = useState('')
  const [logStatus, setLogStatus] = useState('')
  const [logChannel, setLogChannel] = useState('')

  const isAdmin = ['admin', 'director'].includes(me?.role || '')

  const envQ = useQuery({
    queryKey: ['admin', 'env-status', 'diagnostics'],
    queryFn: () => apiFetch<any>('/api/v1/admin/env-status'),
    enabled: isAdmin,
    refetchInterval: 60_000,
  })

  const healthQ = useQuery({
    queryKey: ['admin', 'system-health', 'diagnostics'],
    queryFn: () => apiFetch<any>('/api/v1/admin/system-health'),
    enabled: isAdmin,
    refetchInterval: 60_000,
  })

  const deliveryQ = useQuery({
    queryKey: ['admin', 'notification-delivery-log', 'diagnostics', logStatus, logChannel],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '30' })
      if (logStatus) qs.set('status', logStatus)
      if (logChannel) qs.set('channel', logChannel)
      return apiFetch<{ rows: any[] }>(`/api/v1/admin/notification-delivery-log?${qs.toString()}`)
    },
    enabled: isAdmin,
    refetchInterval: 45_000,
  })

  async function runApiTests() {
    setRunning(true)
    const out: Record<string, TestResult> = {}

    out.user = { id: me?.id?.slice(0, 8), role: me?.role, orgId: me?.orgId?.slice(0, 8) }
    out.hasToken = { ok: !!token }

    try {
      const r = await apiFetch<any>('/api/v1/tasks?limit=3&page=1')
      out.getTasks = { ok: true, count: (r.tasks || r.rows || []).length, total: r.pagination?.total }
    } catch (e: any) { out.getTasks = { ok: false, error: e.message, status: e.status } }

    try {
      const r = await apiFetch<any>('/api/v1/tasks/assignable-users')
      out.getUsers = { ok: true, count: (r.users || []).length }
    } catch (e: any) { out.getUsers = { ok: false, error: e.message, status: e.status } }

    try {
      const r = await apiFetch<any>('/api/v1/search?q=test&limit=5')
      out.globalSearch = { ok: true, total: r.meta?.total ?? 0, groups: { tasks: r.tasks?.length || 0, users: r.users?.length || 0, projects: r.projects?.length || 0 } }
    } catch (e: any) { out.globalSearch = { ok: false, error: e.message, status: e.status } }

    if (isAdmin) {
      try {
        const r = await apiFetch<any>('/api/v1/admin/test-notification', { method: 'POST', json: {} })
        out.testInAppNotification = { ok: true, response: r }
      } catch (e: any) { out.testInAppNotification = { ok: false, error: e.message, status: e.status } }
    }

    setResults(out)
    setRunning(false)
  }

  async function testAdminEndpoint(name: string, path: string, body: Record<string, unknown> = {}) {
    setRunning(true)
    try {
      const r = await apiFetch<any>(path, { method: 'POST', json: body })
      setResults(prev => ({ ...prev, [name]: { ok: true, response: r } }))
      envQ.refetch(); healthQ.refetch(); deliveryQ.refetch()
    } catch (e: any) {
      setResults(prev => ({ ...prev, [name]: { ok: false, error: e.message, status: e.status } }))
    } finally {
      setRunning(false)
    }
  }

  async function retryDelivery(row: any) {
    await testAdminEndpoint(`retry_${row.channel}_${row.id?.slice?.(0, 8) || 'delivery'}`, `/api/v1/admin/notification-delivery-log/${encodeURIComponent(row.id)}/retry`, { channel: row.channel })
  }

  const color = (val: any) => val?.ok === true ? '#22c55e' : val?.ok === false ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">🔬 Live Diagnostics</div>
            <div className="pageHeaderCardSub">Test API health, service configuration, notifications, email, and WhatsApp.</div>
          </div>
          <button className="btn btnPrimary" onClick={runApiTests} disabled={running}>
            {running ? 'Running…' : 'Run core tests'}
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <Card title="Service configuration">
            {envQ.isLoading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
            {envQ.data && (
              <div style={{ display: 'grid', gap: 9 }}>
                {Object.entries(envQ.data.services || {}).map(([name, s]: any) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 850, color: 'var(--text)', textTransform: 'capitalize' }}>{name}</div>
                      {!s.configured && <div style={{ color: 'var(--muted)', fontSize: 11 }}>Missing: {(s.missing || []).join(', ') || 'unknown'}</div>}
                    </div>
                    <StatusPill ok={!!s.configured} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="System health">
            {healthQ.isLoading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
            {healthQ.data && (
              <div style={{ display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Database</span><StatusPill ok={!!healthQ.data.checks?.db?.ok} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Redis</span><StatusPill ok={!!healthQ.data.checks?.redis?.ok} /></div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>Uptime: {healthQ.data.uptime}s · Env: {healthQ.data.nodeEnv}</div>
              </div>
            )}
          </Card>

          <Card title="Notification test tools">
            <div style={{ display: 'grid', gap: 10 }}>
              <button className="btn btnPrimary" disabled={running} onClick={() => testAdminEndpoint('testInAppNotification', '/api/v1/admin/test-notification')}>Send in-app test</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="email@example.com" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
                <button className="btn btnGhost" disabled={running} onClick={() => testAdminEndpoint('testEmail', '/api/v1/admin/test-email', { to: testEmail })}>Email</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="9665XXXXXXXX" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
                <button className="btn btnGhost" disabled={running} onClick={() => testAdminEndpoint('testWhatsApp', '/api/v1/admin/test-whatsapp', { toE164: testPhone })}>WhatsApp</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card title="Recent delivery logs">
        {!isAdmin && <div style={{ color: 'var(--muted)' }}>Admin or director access required.</div>}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={logStatus} onChange={e => setLogStatus(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}>
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
            </select>
            <select value={logChannel} onChange={e => setLogChannel(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}>
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <button className="btn btnGhost" onClick={() => deliveryQ.refetch()} disabled={deliveryQ.isFetching}>Refresh</button>
          </div>
        )}
        {isAdmin && deliveryQ.isLoading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
        {isAdmin && deliveryQ.data && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--muted)', textAlign: 'left' }}><th>User</th><th>Type</th><th>Channel</th><th>Status</th><th>Error</th><th>Sent</th><th>Action</th></tr></thead>
              <tbody>
                {(deliveryQ.data.rows || []).map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px' }}>{r.full_name || r.email || r.user_id}</td>
                    <td style={{ padding: '8px 6px' }}>{r.notif_type}</td>
                    <td style={{ padding: '8px 6px' }}>{r.channel}</td>
                    <td style={{ padding: '8px 6px', color: r.status === 'sent' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#f59e0b', fontWeight: 900 }}>{r.status}</td>
                    <td style={{ padding: '8px 6px', maxWidth: 260, color: 'var(--muted)' }}>{r.error_msg || '—'}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '8px 6px' }}>
                      {r.status === 'failed' ? <button className="btn btnGhost" disabled={running} onClick={() => retryDelivery(r)}>Retry</button> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {Object.keys(results).length > 0 && (
        <Card title="Test results">
          <div style={{ display: 'grid', gap: 12 }}>
            {Object.entries(results).map(([key, val]) => (
              <div key={key} style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--bg2)', border: `2px solid ${color(val)}40` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 900, color: 'var(--text)', fontSize: 14 }}>{key}</span>
                  <span style={{ fontWeight: 900, color: color(val), fontSize: 12 }}>
                    {val?.ok === true ? '✓ PASS' : val?.ok === false ? '✗ FAIL' : val?.skipped ? '— SKIPPED' : 'INFO'}
                  </span>
                </div>
                <pre style={{ margin: 0, color: color(val), background: 'rgba(0,0,0,0.18)', padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 11, lineHeight: 1.5 }}>
                  {JSON.stringify(val, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
