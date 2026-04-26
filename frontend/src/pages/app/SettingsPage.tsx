import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canViewAnalytics } from '../../lib/rbac'

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
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start' }}>
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

export function SettingsPage() {
  const me = getUser()
  const qc = useQueryClient()
  const isAdmin = me?.role === 'admin'
  const canView = canViewAnalytics(me?.role)

  const [tab, setTab] = useState<'org' | 'notifications' | 'security' | 'plan'>('org')
  const [saved, setSaved] = useState(false)

  const { data: org, isLoading } = useQuery({ queryKey: ['org', 'me'], queryFn: fetchOrg })

  const [orgName, setOrgName] = useState('')
  const [timezone, setTimezone] = useState('')

  // Initialize form from fetched org
  useState(() => {
    if (org) { setOrgName(org.name); setTimezone(org.timezone || 'UTC') }
  })

  const m = useMutation({
    mutationFn: (data: Partial<OrgDetails>) => updateOrg(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'me'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
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
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '4px', background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)', width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key as any)} style={{
            padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800,
            background: tab === t.key ? 'var(--bg1)' : 'transparent',
            color: tab === t.key ? 'var(--text)' : 'var(--muted)',
            boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

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
        <Section title="Notification Preferences" sub="Control how and when you receive alerts">
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              { label: 'Task assigned to me', desc: 'When a manager assigns a new task', default: true },
              { label: 'Task approved / rejected', desc: 'Status decisions on your submissions', default: true },
              { label: 'New comment on my task', desc: 'When someone replies in a task thread', default: true },
              { label: 'File uploaded to my task', desc: 'When evidence or documents are attached', default: true },
              { label: 'Task deadline approaching', desc: '24 hours before due date', default: false },
              { label: 'Team performance reports', desc: 'Weekly summary emails (managers only)', default: false },
            ].map(pref => (
              <div key={pref.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 16px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{pref.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{pref.desc}</div>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
                  <input type="checkbox" defaultChecked={pref.default} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: pref.default ? 'var(--brand)' : 'var(--border)', transition: 'background 0.2s', cursor: 'pointer' }} />
                  <span style={{ position: 'absolute', top: 2, left: pref.default ? 'calc(100% - 22px)' : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </label>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(226,171,65,0.08)', border: '1px solid rgba(226,171,65,0.2)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--brand)', marginBottom: 4 }}>WhatsApp & Email Notifications</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
              To enable WhatsApp and email delivery, configure <code style={{ background: 'var(--bg2)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>SMTP_*</code> and <code style={{ background: 'var(--bg2)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>WHATSAPP_TOKEN</code> environment variables in your Railway dashboard.
            </div>
          </div>
        </Section>
      )}

      {/* ── Security tab ── */}
      {tab === 'security' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Section title="Access & Security" sub="Control authentication and session settings">
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                { label: 'Role-based access control', status: 'Active', color: '#22c55e', desc: '5 roles: Admin, HR, Manager, Supervisor, Employee' },
                { label: 'JWT token expiry', status: '15 min', color: '#38bdf8', desc: 'Auto-refreshed with 7-day refresh tokens' },
                { label: 'API rate limiting', status: 'Active', color: '#22c55e', desc: 'Per-endpoint limits to prevent abuse' },
                { label: 'Input sanitization', status: 'Active', color: '#22c55e', desc: 'All inputs validated against SQL injection & XSS' },
                { label: 'Audit logging', status: 'Active', color: '#22c55e', desc: 'All sensitive actions logged with actor + timestamp' },
                { label: 'Two-factor authentication', status: 'Coming soon', color: '#9ca3af', desc: 'TOTP-based 2FA for admin accounts' },
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
        </div>
      )}

      {/* ── Plan tab ── */}
      {tab === 'plan' && (
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
      )}
    </div>
  )
}
