import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'

type Tab = 'overview' | 'audit' | 'readiness' | 'delivery' | 'actions'
type Row = Record<string, unknown>

function Pill({ ok, text }: { ok?: boolean; text?: string }) {
  return <span style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 900, background: ok ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)', color: ok ? '#22c55e' : '#ef4444' }}>{text || (ok ? 'OK' : 'Issue')}</span>
}
function Empty({ title, body }: { title: string; body: string }) { return <div className="qaEmptyState"><div className="qaEmptyStateIcon">-</div><div className="qaEmptyStateTitle">{title}</div><div className="qaEmptyStateBody">{body}</div></div> }
function Skeleton() { return <div style={{ display: 'grid', gap: 10 }}>{[0,1,2,3].map(i => <div key={i} className="skeletonBlock" style={{ height: 64 }} />)}</div> }
function download(kind: 'tasks' | 'users' | 'audit') { window.open(`/api/v1/admin/exports/${kind}.csv`, '_blank') }

export function OperationsCenterPage() {
  const me = getUser()
  const isAdmin = ['admin', 'director'].includes(me?.role || '')
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(30)
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [email, setEmail] = useState(me?.email || '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Row | null>(null)

  const auditQ = useQuery({ queryKey: ['ops-audit', days], enabled: isAdmin, queryFn: () => apiFetch<{ entries: Row[] }>(`/api/v1/audit?days=${days}&limit=200`) })
  const envQ = useQuery({ queryKey: ['ops-env'], enabled: isAdmin, refetchInterval: 60000, queryFn: () => apiFetch<{ services: Record<string, { configured?: boolean; missing?: string[] }> }>('/api/v1/admin/env-status') })
  const healthQ = useQuery({ queryKey: ['ops-health'], enabled: isAdmin, refetchInterval: 60000, queryFn: () => apiFetch<{ ok?: boolean; checks?: { db?: { latencyMs?: number } } }>('/api/v1/admin/system-health') })
  const readyQ = useQuery({ queryKey: ['ops-ready'], enabled: isAdmin, refetchInterval: 120000, queryFn: () => apiFetch<{ items: { area: string; item: string; ok: boolean; required: boolean }[] }>('/api/v1/admin/readiness-checklist') })
  const deliveryQ = useQuery({ queryKey: ['ops-delivery', status, channel], enabled: isAdmin, refetchInterval: 45000, queryFn: () => { const qs = new URLSearchParams({ limit: '40' }); if (status) qs.set('status', status); if (channel) qs.set('channel', channel); return apiFetch<{ rows: Row[] }>(`/api/v1/admin/notification-delivery-log?${qs}`) } })

  const services = envQ.data?.services || {}
  const delivery = deliveryQ.data?.rows || []
  const entries = auditQ.data?.entries || []
  const requiredReady = readyQ.data?.items?.filter(i => i.required).every(i => i.ok) ?? false
  const configured = Object.values(services).filter(s => s.configured).length
  const failed = delivery.filter(r => r.status === 'failed').length

  async function post(name: string, path: string, body: Row = {}) {
    setBusy(true)
    try { setResult({ [name]: await apiFetch(path, { method: 'POST', json: body }) }); auditQ.refetch(); deliveryQ.refetch(); envQ.refetch(); readyQ.refetch(); healthQ.refetch() }
    catch (err) { setResult({ [name]: { ok: false, error: err instanceof Error ? err.message : 'Failed' } }) }
    finally { setBusy(false) }
  }
  async function backup() {
    setBusy(true)
    try { setResult({ backup: await apiFetch('/api/v1/admin/backup-validation') }); auditQ.refetch() }
    catch (err) { setResult({ backup: { ok: false, error: err instanceof Error ? err.message : 'Failed' } }) }
    finally { setBusy(false) }
  }

  if (!isAdmin) return <Empty title="Operations Center requires admin access" body="Only admin and director users can view this page." />

  return <div style={{ display: 'grid', gap: 18 }}>
    <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Operations Center</div><div className="pageHeaderCardSub">Unified audit, diagnostics, readiness, exports, delivery logs, and validation tools.</div><div className="pageHeaderCardMeta"><span className="pageHeaderCardTag">System: {healthQ.data?.ok ? 'Good' : 'Check'}</span><span className="pageHeaderCardTag">Readiness: {requiredReady ? 'Ready' : 'Needs work'}</span><span className="pageHeaderCardTag">Services: {Object.keys(services).length ? `${configured}/${Object.keys(services).length}` : '-'}</span><span className="pageHeaderCardTag" style={{ color: failed ? '#ef4444' : '#22c55e', background: failed ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)', borderColor: failed ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.22)' }}>Failed delivery: {failed}</span></div></div><div className="opsToolbar"><button className="btn btnGhost" disabled={busy} onClick={() => post('health', '/api/v1/admin/health/run-checks')}>Run checks</button><button className="btn btnPrimary" onClick={() => setTab('actions')}>Admin actions</button></div></div></div>
    <div className="opsTabs">{(['overview','audit','readiness','delivery','actions'] as Tab[]).map(t => <button key={t} className={`opsTab ${tab === t ? 'opsTabActive' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'overview' && <div className="responsiveCardGrid"><Panel title="Service configuration" sub="Live integration readiness.">{envQ.isLoading ? <Skeleton /> : <div style={{ display: 'grid', gap: 10 }}>{Object.entries(services).map(([name, svc]) => <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><div style={{ color: 'var(--text)', fontWeight: 900 }}>{name}</div>{!svc.configured && <div style={{ color: 'var(--muted)', fontSize: 11 }}>Missing: {(svc.missing || []).join(', ')}</div>}</div><Pill ok={!!svc.configured} /></div>)}</div>}</Panel><Panel title="Recent audit activity" sub="Latest system events."><AuditList entries={entries.slice(0, 5)} loading={auditQ.isLoading} /></Panel></div>}
    {tab === 'audit' && <Panel title="Audit trail" sub="Who did what, when, and from where." action={<select value={days} onChange={e => setDays(parseInt(e.target.value, 10))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>}><AuditList entries={entries} loading={auditQ.isLoading} /></Panel>}
    {tab === 'readiness' && <Panel title="Environment readiness checklist" sub="Required and optional production checks.">{readyQ.isLoading ? <Skeleton /> : <div className="responsiveCardGrid">{readyQ.data?.items?.map(i => <div key={`${i.area}-${i.item}`} className="opsKpi"><div className="opsKpiLabel">{i.area}{i.required ? ' required' : ' optional'}</div><div style={{ color: 'var(--text)', fontWeight: 950, marginTop: 8 }}>{i.item}</div><div style={{ marginTop: 10 }}><Pill ok={i.ok} /></div></div>)}</div>}</Panel>}
    {tab === 'delivery' && <Panel title="Notification delivery logs" sub="Email and WhatsApp status with retry." action={<div className="opsToolbar"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select><select value={channel} onChange={e => setChannel(e.target.value)}><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></div>}>{deliveryQ.isLoading ? <Skeleton /> : !delivery.length ? <Empty title="No delivery logs yet" body="When notifications are sent, delivery results will appear here." /> : <div className="opsTableWrap"><table className="opsTable"><thead><tr><th>User</th><th>Type</th><th>Channel</th><th>Status</th><th>Error</th><th>Sent</th><th>Action</th></tr></thead><tbody>{delivery.map(r => <tr key={String(r.id)}><td>{String(r.full_name || r.email || r.user_id || '-')}</td><td>{String(r.notif_type || '-')}</td><td>{String(r.channel || '-')}</td><td><Pill ok={r.status === 'sent'} text={String(r.status || '-')} /></td><td>{String(r.error_msg || '-')}</td><td>{r.sent_at ? new Date(String(r.sent_at)).toLocaleString() : '-'}</td><td>{r.status === 'failed' ? <button className="btn btnGhost" disabled={busy} onClick={() => post('retry', `/api/v1/admin/notification-delivery-log/${encodeURIComponent(String(r.id))}/retry`, { channel: r.channel })}>Retry</button> : '-'}</td></tr>)}</tbody></table></div>}</Panel>}
    {tab === 'actions' && <div className="responsiveCardGrid"><Panel title="Admin actions" sub="Health, backup, and exports."><div style={{ display: 'grid', gap: 10 }}><button className="btn btnPrimary" disabled={busy} onClick={() => post('health', '/api/v1/admin/health/run-checks')}>Run admin health checks</button><button className="btn btnGhost" disabled={busy} onClick={backup}>Run backup validation</button><button className="btn btnGhost" onClick={() => download('tasks')}>Export tasks CSV</button><button className="btn btnGhost" onClick={() => download('users')}>Export users CSV</button><button className="btn btnGhost" onClick={() => download('audit')}>Export audit CSV</button></div></Panel><Panel title="Notification tests" sub="Send diagnostics."><div style={{ display: 'grid', gap: 10 }}><button className="btn btnPrimary" disabled={busy} onClick={() => post('inApp', '/api/v1/admin/test-notification')}>Send in-app test</button><input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" aria-invalid={email.length > 0 && !email.includes('@')} style={{ height: 42, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 12px' }} />{email.length > 0 && !email.includes('@') ? <div className="inlineFieldError">Enter a valid email address.</div> : null}<button className="btn btnGhost" disabled={busy || !email.includes('@')} onClick={() => post('email', '/api/v1/admin/test-email', { to: email })}>Send test email</button><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9665XXXXXXXX" style={{ height: 42, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 12px' }} /><button className="btn btnGhost" disabled={busy || phone.trim().length < 8} onClick={() => post('whatsapp', '/api/v1/admin/test-whatsapp', { toE164: phone })}>Send test WhatsApp</button></div></Panel></div>}
    {result && <Panel title="Action results" sub="Latest admin output."><pre style={{ margin: 0, overflowX: 'auto', fontSize: 11, color: 'var(--text2)' }}>{JSON.stringify(result, null, 2)}</pre></Panel>}
  </div>
}

function Panel({ title, sub, action, children }: { title: string; sub: string; action?: React.ReactNode; children: React.ReactNode }) { return <div className="opsPanel"><div className="opsPanelHead"><div><div className="opsPanelTitle">{title}</div><div className="opsPanelSub">{sub}</div></div>{action}</div><div className="opsPanelBody">{children}</div></div> }
function AuditList({ entries, loading }: { entries: Row[]; loading: boolean }) { if (loading) return <Skeleton />; if (!entries.length) return <Empty title="No audit entries" body="System events will appear here as they occur." />; return <div className="opsTimeline">{entries.map(e => <div key={String(e.id)} className="opsTimelineItem"><span className="opsTimelineDot" /><div><div className="opsTimelineTitle">{String(e.action || '-')}</div><div className="opsTimelineMeta">{String(e.actor_name || 'System')} - {String(e.entity_type || '-')} - {e.created_at ? new Date(String(e.created_at)).toLocaleString() : '-'}</div></div></div>)}</div> }
