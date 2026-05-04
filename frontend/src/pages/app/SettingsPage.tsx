import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canViewAnalytics } from '../../lib/rbac'
import { useToast } from '../../components/ui/ToastSystem'
type OrgDetails = {
  id: string; name: string; slug: string; plan?: string | null
  timezone?: string | null; logoUrl?: string | null
  emailDomain?: string | null; employeeCount?: number
  createdAt?: string
}

const TIMEZONES = [
  'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Istanbul',
  'Asia/Dubai','Asia/Riyadh','Asia/Karachi','Asia/Kolkata','Asia/Bangkok',
  'Asia/Singapore','Asia/Tokyo','Australia/Sydney','Africa/Cairo','Africa/Johannesburg',
]

async function fetchOrg(): Promise<OrgDetails> {
  const d = await apiFetch<{ organization: OrgDetails }>('/api/v1/organizations/me')
  return d.organization
}

async function updateOrg(data: Partial<OrgDetails>) {
  return apiFetch<{ organization: OrgDetails }>('/api/v1/organizations/me', { method: 'PATCH', json: data })
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '22px 24px', display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settingsField">
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text2)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '10px 14px', borderRadius: 11,
    border: '1.5px solid var(--border)', background: 'var(--bg2)',
    color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  }
}

function TwoFactorSection() {
  const { success: toastSuccess, error: toastError } = useToast()
  const me = getUser()
  const [step, setStep] = useState<'idle' | 'setup' | 'confirm' | 'done' | 'disabling'>('idle')
  const [qrUrl, setQrUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)

  // Check current MFA status from /me endpoint
  useQuery({
    queryKey: ['me-mfa-status'],
    queryFn: () => apiFetch<{ user?: { mfa_enabled?: boolean } }>(`/api/v1/users/${me?.id}`).then(d => {
      setEnabled(!!d?.user?.mfa_enabled)
      return d
    }).catch(() => null),
    enabled: !!me?.id,
    staleTime: 30_000,
  })

  const startM = useMutation({
    mutationFn: () => apiFetch<{ secret: string; otpauthUrl: string }>('/api/v1/auth/mfa/enroll/start', { method: 'POST' }),
    onSuccess: (d) => {
      setSecret(d.secret)
      setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(d.otpauthUrl)}&size=200x200&format=png&bgcolor=ffffff&color=000000`)
      setStep('setup')
    },
    onError: () => toastError('2FA Error', 'Failed to start 2FA enrollment.'),
  })

  const confirmM = useMutation({
    mutationFn: () => apiFetch<{ recoveryCodes: string[] }>('/api/v1/auth/mfa/enroll/confirm', { method: 'POST', json: { secret, code: code.replace(/\s/g, '') } }),
    onSuccess: (d) => {
      setRecoveryCodes(d.recoveryCodes || [])
      setEnabled(true)
      setStep('done')
      toastSuccess('2FA Enabled', 'Two-factor authentication is now active on your account.')
    },
    onError: () => toastError('Invalid code', 'The code you entered is incorrect. Try again.'),
  })

  const disableM = useMutation({
    mutationFn: () => apiFetch('/api/v1/auth/mfa/disable', { method: 'POST', json: { code: disableCode.replace(/\s/g, '') } }),
    onSuccess: () => {
      setEnabled(false)
      setStep('idle')
      setDisableCode('')
      toastSuccess('2FA Disabled', 'Two-factor authentication has been removed from your account.')
    },
    onError: () => toastError('Invalid code', 'The verification code is incorrect. Try again.'),
  })

  return (
    <Section title="Two-Factor Authentication" sub="Protect your account with TOTP (Google Authenticator, Authy, etc.)">
      {step === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
              Status: <span style={{ color: enabled ? '#22c55e' : '#f59e0b', fontWeight: 900 }}>{enabled ? '✓ Enabled' : '○ Not enabled'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              {enabled ? 'Your account is protected with 2FA.' : 'Add an extra layer of security to your account.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!enabled && (
              <button className="btn btnPrimary" onClick={() => startM.mutate()} disabled={startM.isPending}>
                {startM.isPending ? 'Starting…' : 'Enable 2FA'}
              </button>
            )}
            {enabled && (
              <button className="btn btnGhost" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                onClick={() => { setStep('disabling'); setDisableCode('') }}>
                Disable 2FA
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'disabling' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>⚠ Disabling 2FA reduces account security</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Enter your current authenticator code to confirm.</div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 6 }}>Authenticator Code</label>
            <input
              value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="000000" maxLength={6}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 20, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
              onKeyDown={e => e.key === 'Enter' && disableCode.length === 6 && disableM.mutate()}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btnGhost" onClick={() => setStep('idle')} style={{ flex: 1 }}>Cancel</button>
            <button className="btn" style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none' }}
              disabled={disableCode.length !== 6 || disableM.isPending}
              onClick={() => disableM.mutate()}>
              {disableM.isPending ? 'Disabling…' : 'Confirm Disable'}
            </button>
          </div>
        </div>
      )}

      {step === 'setup' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>1. Scan this QR code</div>
              <img src={qrUrl} alt="2FA QR Code" width={180} height={180} style={{ borderRadius: 12, border: '2px solid var(--border)', display: 'block' }} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Or enter this key manually:</div>
              <code style={{ fontSize: 12, background: 'var(--bg2)', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', display: 'block', wordBreak: 'break-all', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--brand)' }}>{secret}</code>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                Use <strong>Google Authenticator</strong>, <strong>Authy</strong>, or any TOTP app to scan the QR code. Then enter the 6-digit code below.
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>2. Enter the 6-digit code to confirm</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                style={{ width: 140, padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 20, fontWeight: 900, letterSpacing: '0.2em', textAlign: 'center', outline: 'none', fontFamily: 'monospace' }}
                onKeyDown={e => e.key === 'Enter' && code.length === 6 && confirmM.mutate()}
              />
              <button className="btn btnPrimary" onClick={() => confirmM.mutate()} disabled={code.length !== 6 || confirmM.isPending}>
                {confirmM.isPending ? 'Verifying…' : 'Verify & Enable'}
              </button>
              <button className="btn btnGhost" onClick={() => { setStep('idle'); setCode(''); setSecret(''); setQrUrl('') }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(34,197,94,0.08)', border: '1.5px solid rgba(34,197,94,0.25)', color: '#22c55e', fontWeight: 700, fontSize: 14 }}>
            ✓ Two-factor authentication is now active!
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>⚠️ Save your recovery codes — they won't be shown again</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6, background: 'var(--bg2)', padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
              {recoveryCodes.map(c => (
                <code key={c} style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.05em' }}>{c}</code>
              ))}
            </div>
            <button className="btn btnGhost" style={{ marginTop: 10 }} onClick={() => {
              const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recovery-codes.txt'; a.click()
            }}>
              Download recovery codes
            </button>
          </div>
          <button className="btn btnGhost" onClick={() => setStep('idle')}>Done</button>
        </div>
      )}
    </Section>
  )
}

const NOTIF_PREFS = [
  { key: 'task_assigned',   label: 'Task assigned to me',       desc: 'When a manager assigns a new task',              defaultOn: true },
  { key: 'task_approved',   label: 'Task approved / rejected',  desc: 'Status decisions on your submissions',           defaultOn: true },
  { key: 'task_comment',    label: 'New comment on my task',    desc: 'When someone replies in a task thread',          defaultOn: true },
  { key: 'task_file',       label: 'File uploaded to my task',  desc: 'When evidence or documents are attached',        defaultOn: true },
  { key: 'task_overdue',    label: 'Task deadline approaching', desc: '24 hours before due date',                       defaultOn: true },
  { key: 'reports_weekly',  label: 'Weekly performance reports',desc: 'Weekly summary email (managers only)',            defaultOn: false },
]

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{ position:'relative', width:44, height:24, borderRadius:999, border:'none', cursor:'pointer',
        background: on ? 'var(--brand)' : 'rgba(148,163,184,0.25)', transition:'background 0.2s', flexShrink:0, padding:0 }}>
      <span style={{ position:'absolute', top:2, left: on ? 'calc(100% - 22px)' : 2, width:20, height:20,
        borderRadius:'50%', background:'#fff', transition:'left 0.18s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)', display:'block' }} />
    </button>
  )
}

function NotificationsTab({ me }: { me: ReturnType<typeof getUser> }) {
  const { success: toastSuccess, error: toastError } = useToast()
  const userId = me?.id || ''

  // Load current prefs from DB
  const q = useQuery({
    queryKey: ['user-notif-prefs', userId],
    queryFn: () => apiFetch<{ user?: { notification_prefs?: Record<string, unknown> } }>(`/api/v1/users/${userId}`)
      .then(d => d.user?.notification_prefs || {}),
    enabled: !!userId,
    staleTime: 60_000,
  })

  const [prefs, setPrefs] = useState<Record<string, boolean>>({})

  // Sync prefs from DB on load
  useEffect(() => {
    if (!q.data) return
    const p: Record<string, boolean> = {}
    for (const n of NOTIF_PREFS) {
      p[n.key] = q.data[n.key] !== false // default true unless explicitly false
    }
    // Channel prefs
    const channels = (q.data.channels || {}) as Record<string, boolean>
    p['ch_email']    = channels.email     !== false
    p['ch_whatsapp'] = channels.whatsapp  === true
    setPrefs(p)
  }, [q.data])

  const saveM = useMutation({
    mutationFn: () => {
      const channels = { email: !!prefs['ch_email'], whatsapp: !!prefs['ch_whatsapp'] }
      const notifPrefs: Record<string, unknown> = { channels }
      for (const n of NOTIF_PREFS) notifPrefs[n.key] = !!prefs[n.key]
      return apiFetch(`/api/v1/users/${userId}`, { method: 'PATCH', json: { notificationPrefs: notifPrefs } })
    },
    onSuccess: () => toastSuccess('Preferences saved', 'Your notification settings have been updated.'),
    onError: () => toastError('Save failed', 'Could not save your notification preferences.'),
  })

  const toggle = useCallback((key: string) => setPrefs(p => ({ ...p, [key]: !p[key] })), [])

  if (q.isLoading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title="Notification Events" sub="Choose which events trigger a notification">
        <div style={{ display: 'grid', gap: 8 }}>
          {NOTIF_PREFS.map(n => (
            <div key={n.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, padding:'13px 16px', borderRadius:12, background:'var(--bg2)', border:'1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:'var(--text)' }}>{n.label}</div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{n.desc}</div>
              </div>
              <ToggleSwitch on={prefs[n.key] ?? n.defaultOn} onChange={() => toggle(n.key)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Delivery Channels" sub="How notifications are delivered to you">
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            { key: 'ch_email',    label: 'Email',    desc: 'Sent to your account email address',         icon: '✉️' },
            { key: 'ch_whatsapp', label: 'WhatsApp', desc: 'Sent to your WhatsApp number (set in Profile)', icon: '💬' },
          ].map(ch => (
            <div key={ch.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, padding:'13px 16px', borderRadius:12, background:'var(--bg2)', border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:16 }}>{ch.icon}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:800, color:'var(--text)' }}>{ch.label}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{ch.desc}</div>
                </div>
              </div>
              <ToggleSwitch on={prefs[ch.key] ?? false} onChange={() => toggle(ch.key)} />
            </div>
          ))}
        </div>
        <div style={{ padding:'12px 14px', borderRadius:10, background:'rgba(226,171,65,0.07)', border:'1px solid rgba(226,171,65,0.18)', marginTop:4 }}>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            <strong style={{ color:'var(--brand)' }}>Setup required:</strong> Email needs <code style={{ fontSize:10, background:'var(--bg2)', padding:'1px 5px', borderRadius:4 }}>SMTP_HOST</code> in Railway. WhatsApp needs <code style={{ fontSize:10, background:'var(--bg2)', padding:'1px 5px', borderRadius:4 }}>WHATSAPP_TOKEN</code> + your number in Profile.
          </div>
        </div>
      </Section>

      <div>
        <button className="btn btnPrimary" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
          {saveM.isPending ? 'Saving…' : 'Save notification preferences'}
        </button>
      </div>
    </div>
  )
}

function ServiceHealthBanner() {
  const q = useQuery({
    queryKey: ['admin', 'env-status'],
    queryFn: () => apiFetch<{
      ok: boolean
      services: Record<string, { configured: boolean; missing: string[] }>
    }>('/api/v1/admin/env-status'),
    staleTime: 300_000,
  })
  if (!q.data || q.data.ok) return null
  const broken = Object.entries(q.data.services).filter(([, s]) => !s.configured)
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(245,158,11,0.09)', border: '1.5px solid rgba(245,158,11,0.3)', marginBottom: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 13, color: '#f59e0b', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Services not configured — some features are inactive
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {broken.map(([name, s]) => (
          <div key={name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12 }}>
            <span style={{ color: '#ef4444', fontWeight: 800, flexShrink: 0 }}>✗</span>
            <div>
              <span style={{ fontWeight: 800, color: 'var(--text)', textTransform: 'capitalize' }}>{name}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 6 }}>missing: {s.missing.join(', ')}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
        → Add these in Railway dashboard: <strong>Settings → Variables</strong>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const me = getUser()
  const qc = useQueryClient()
  const isAdmin = ['admin', 'director'].includes(me?.role || '')
  const canView = canViewAnalytics(me?.role)
  const { success: toastSuccess, error: toastError } = useToast()

  const [tab, setTab] = useState<'org' | 'notifications' | 'security' | 'plan'>('org')
  const [saved, setSaved] = useState(false)

  const { data: org, isLoading } = useQuery({ queryKey: ['org', 'me'], queryFn: fetchOrg })

  const [orgName, setOrgName] = useState('')
  const [timezone, setTimezone] = useState('')

  // Initialize form from fetched org data
  useEffect(() => {
    if (org) {
      if (!orgName) setOrgName(org.name || '')
      if (!timezone) setTimezone(org.timezone || 'UTC')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  const m = useMutation({
    mutationFn: (data: Partial<OrgDetails>) => updateOrg(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'me'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      toastSuccess('Settings saved', 'Organization settings have been updated.')
    },
    onError: (err) => {
      toastError('Save failed', err instanceof ApiError ? err.message : 'Could not save settings.')
    },
  })

  function onSaveOrg(e: FormEvent) {
    e.preventDefault()
    m.mutate({ name: orgName.trim(), timezone })
  }

  if (!canView) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Access restricted</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Settings are available to managers and above.</div>
    </div>
  )

  const TABS = [
    { key: 'org', label: '🏢 Organization' },
    { key: 'notifications', label: '🔔 Notifications' },
    { key: 'security', label: '🔐 Security' },
    { key: 'plan', label: '💳 Plan & Billing' },
  ]

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 1.41 13.27M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>
              Settings
            </div>
            <div className="pageHeaderCardSub">Manage your organization, notifications, and account preferences</div>
          </div>
          {/* Tab bar on right side of header */}
          <div style={{ display: 'flex', gap: 4, padding: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: 12, border: '1px solid var(--border)', flexShrink: 0 }}>
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setTab(t.key as any)} style={{
                padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                background: tab === t.key ? 'var(--brand)' : 'transparent',
                color: tab === t.key ? '#1a1d2e' : 'var(--text2)',
                boxShadow: tab === t.key ? '0 1px 6px rgba(226,171,65,0.3)' : 'none',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* REMOVED: separate tab bar card (now inside header) */}

      {/* ── Org tab ── */}
      {tab === 'org' && (
        <form onSubmit={onSaveOrg} style={{ display: 'grid', gap: 16 }}>
          {isLoading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="3" style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 8px' }}><circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
              Loading…
            </div>
          ) : (
            <>
              <Section title="Organization Details" sub="Basic information about your workspace">
                <Field label="Organization name" hint="Visible to all team members">
                  <input style={inputStyle()} value={orgName || org?.name || ''} onChange={e => setOrgName(e.target.value)}
                    placeholder="Acme Corp" disabled={!isAdmin}
                    onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--brandBorder)'}
                    onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
                  />
                </Field>
                <Field label="Workspace URL" hint="Cannot be changed after creation">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>app.taskflow.pro/</span>
                    <input style={{ ...inputStyle(), opacity: 0.6 }} value={org?.slug || ''} disabled />
                  </div>
                </Field>
                <Field label="Timezone" hint="Used for deadline notifications and reports">
                  <select style={{ ...inputStyle(), height: 42 }} value={timezone || org?.timezone || 'UTC'} onChange={e => setTimezone(e.target.value)} disabled={!isAdmin}
                    onFocus={e => (e.target as HTMLSelectElement).style.borderColor = 'var(--brandBorder)'}
                    onBlur={e => (e.target as HTMLSelectElement).style.borderColor = 'var(--border)'}
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Field>
                <Field label="Plan" hint="Your current subscription">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: 'var(--brandDim)', border: '1px solid var(--brandBorder)', color: 'var(--brand)', fontSize: 13, fontWeight: 900 }}>
                    {org?.plan ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1) : 'Basic'}
                  </div>
                </Field>
              </Section>

              <Section title="Usage" sub="Current workspace statistics">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Team Members', value: org?.employeeCount ?? '—', color: 'var(--brand)' },
                    { label: 'Workspace Age', value: org?.createdAt ? `${Math.floor((Date.now() - new Date(org.createdAt).getTime()) / 86400000)}d` : '—', color: '#8B5CF6' },
                    { label: 'Plan', value: org?.plan || 'basic', color: '#22c55e' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--bg2)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 950, color, letterSpacing: '-0.5px' }}>{value}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </Section>

              {isAdmin && (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  {saved && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#22c55e', fontWeight: 700 }}>✓ Saved</div>}
                  {m.isError && <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>⚠ {m.error instanceof ApiError ? m.error.message : 'Save failed'}</div>}
                  <button type="submit" className="btn btnPrimary" disabled={m.isPending}>
                    {m.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              )}
            </>
          )}
        </form>
      )}

      {/* ── Notifications tab ── */}
      {tab === 'notifications' && (
        <NotificationsTab me={me} />
      )}

      {/* ── Security tab ── */}
      {tab === 'security' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Section title="Access & Security" sub="Current authentication and access configuration">
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                { label: 'Role-based access control', status: 'Active', color: '#22c55e', desc: '5 roles: Admin, HR, Manager, Supervisor, Employee' },
                { label: 'JWT token expiry', status: '15 min', color: '#38bdf8', desc: 'Auto-refreshed with 7-day refresh tokens' },
                { label: 'API rate limiting', status: 'Active', color: '#22c55e', desc: 'Per-endpoint limits to prevent abuse' },
                { label: 'Input sanitization', status: 'Active', color: '#22c55e', desc: 'All inputs validated against SQL injection & XSS' },
                { label: 'Audit logging', status: 'Active', color: '#22c55e', desc: 'All sensitive actions logged with actor + timestamp' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: item.color + '18', color: item.color }}>{item.status}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Planned Security Features" sub="Features on the roadmap — not yet available">
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'IP allowlist', desc: 'Restrict access to specific IP ranges or CIDR blocks', eta: 'Q3 2026' },
                { label: 'SSO / SAML', desc: 'Enterprise single sign-on via SAML 2.0 or OIDC', eta: 'Q3 2026' },
                { label: 'Device trust', desc: 'Require device registration before accessing sensitive data', eta: 'Q4 2026' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', opacity: 0.75 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.desc}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>ETA {item.eta}</span>
                </div>
              ))}
            </div>
          </Section>
          <TwoFactorSection />
        </div>
      )}

      {/* ── Plan tab ── */}
      {tab === 'plan' && (
        <>
          {isAdmin && <ServiceHealthBanner />}
          <Section title="Plan & Billing" sub="Manage your subscription and payment details">
          <div style={{ padding: '20px', borderRadius: 14, background: 'var(--brandDim)', border: '1.5px solid var(--brandBorder)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Current Plan</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: 'var(--brand)', letterSpacing: '-0.5px' }}>{org?.plan ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1) : 'Basic'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a href="/app/billing" className="btn btnPrimary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Manage Billing
              </a>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'Seats used', value: `${org?.employeeCount || 0} members` },
              { label: 'Plan limits', value: org?.plan === 'pro' ? '50 members' : org?.plan === 'enterprise' ? 'Unlimited' : '10 members' },
              { label: 'Renewal', value: 'Contact support' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
                <span style={{ color: 'var(--text)', fontWeight: 800 }}>{value}</span>
              </div>
            ))}
          </div>
        </Section>
        </>
      )}
    </div>
  )
}
