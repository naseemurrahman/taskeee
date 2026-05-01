import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../components/ui/ToastSystem'

type OrgMe = {
  id: string; name: string
  settings?: { onboardingCompleted?: boolean } | null
}

async function fetchOrg() {
  const data = await apiFetch<{ organization: OrgMe }>('/api/v1/organizations/me')
  return data.organization
}

const STEPS = [
  { id: 'departments', title: 'Set up departments', icon: '🏢', desc: 'Organize your team into departments for cleaner task routing.' },
  { id: 'role', title: 'Default invite role', icon: '👤', desc: 'Choose the default role when you invite new team members.' },
  { id: 'invites', title: 'Invite your team', icon: '✉️', desc: 'Enter email addresses to send invites when ready.' },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const orgQ = useQuery({ queryKey: ['org', 'onboarding'], queryFn: fetchOrg })
  const { success: toastSuccess, error: toastError } = useToast()

  const [step, setStep] = useState(0)
  const [departmentSeed, setDepartmentSeed] = useState('Operations, Engineering, Sales')
  const [defaultRole, setDefaultRole] = useState('manager')
  const [inviteEmails, setInviteEmails] = useState('')

  const saveM = useMutation({
    mutationFn: async () =>
      apiFetch('/api/v1/organizations/onboarding/complete', {
        method: 'POST',
        json: {
          onboarding: {
            departmentSeed: departmentSeed.split(',').map((v) => v.trim()).filter(Boolean),
            defaultRole,
            inviteEmails: inviteEmails.split(',').map((v) => v.trim()).filter(Boolean),
          },
        },
      }),
    onSuccess: () => {
      toastSuccess('Setup complete! 🎉', 'Your workspace is ready. Let\'s get to work.')
      setTimeout(() => navigate('/app/dashboard'), 1200)
    },
    onError: (err: any) => toastError('Setup failed', err?.message || 'Could not complete onboarding.'),
  })

  const done = !!orgQ.data?.settings?.onboardingCompleted

  if (done) {
    return (
      <div style={{ display: 'grid', gap: 18 }}>
        <div className="pageHeaderCard">
          <div className="pageHeaderCardInner">
            <div className="pageHeaderCardLeft">
              <div className="pageHeaderCardTitle">Organization Onboarding</div>
              <div className="pageHeaderCardSub">Your workspace is already configured and ready.</div>
            </div>
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 52 }}>🎉</div>
          <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>Onboarding already complete</div>
          <div style={{ color: 'var(--text2)', fontSize: 14, maxWidth: 360, lineHeight: 1.6 }}>
            Your organization is set up and running. Manage settings from the Settings page.
          </div>
          <button className="btn btnPrimary" onClick={() => navigate('/app/dashboard')} style={{ marginTop: 8 }}>
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <span style={{ fontSize: 20 }}>🚀</span>
              Set Up Your Workspace
            </div>
            <div className="pageHeaderCardSub">Configure your organization in {STEPS.length} quick steps.</div>
            <div className="pageHeaderCardMeta">
              {STEPS.map((s, i) => (
                <span key={s.id} className="pageHeaderCardTag" style={{
                  color: i < step ? '#22c55e' : i === step ? 'var(--primary)' : 'var(--muted)',
                  background: i < step ? 'rgba(34,197,94,0.10)' : i === step ? 'rgba(251,191,36,0.10)' : 'transparent',
                  borderColor: i < step ? 'rgba(34,197,94,0.3)' : i === step ? 'rgba(251,191,36,0.3)' : 'transparent',
                }}>
                  {i < step ? '✓' : i + 1}. {s.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 5, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999,
          background: 'linear-gradient(90deg, var(--primary), #f97316)',
          width: `${Math.round(((step + 1) / STEPS.length) * 100)}%`,
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Step card */}
      <div className="card" style={{ padding: '32px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16, fontSize: 24,
            background: 'rgba(251,191,36,0.12)', border: '1.5px solid rgba(251,191,36,0.3)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            {STEPS[step].icon}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', marginBottom: 4 }}>{STEPS[step].title}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{STEPS[step].desc}</div>
          </div>
        </div>

        {step === 0 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
                Departments <span style={{ color: 'var(--muted)', fontWeight: 500 }}>(comma-separated)</span>
              </label>
              <input
                className="input"
                value={departmentSeed}
                onChange={e => setDepartmentSeed(e.target.value)}
                placeholder="Operations, Engineering, Sales, HR"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {departmentSeed.split(',').map(d => d.trim()).filter(Boolean).map(d => (
                  <span key={d} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(251,191,36,0.12)', color: 'var(--primary)', border: '1px solid rgba(251,191,36,0.3)' }}>{d}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {(['supervisor', 'manager', 'hr'] as const).map(r => (
              <label
                key={r}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                  borderRadius: 14, border: `1.5px solid ${defaultRole === r ? 'rgba(251,191,36,0.5)' : 'var(--border)'}`,
                  background: defaultRole === r ? 'rgba(251,191,36,0.07)' : 'var(--bg2)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <input type="radio" name="role" value={r} checked={defaultRole === r} onChange={() => setDefaultRole(r)} style={{ display: 'none' }} />
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${defaultRole === r ? 'var(--primary)' : 'var(--border)'}`,
                  background: defaultRole === r ? 'var(--primary)' : 'transparent',
                  display: 'grid', placeItems: 'center',
                }}>
                  {defaultRole === r && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#000' }} />}
                </div>
                <div>
                  <div style={{ fontWeight: 750, fontSize: 14, color: 'var(--text)', textTransform: 'capitalize' }}>{r}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {r === 'supervisor' ? 'Can view and submit tasks, limited permissions' :
                     r === 'manager' ? 'Can create tasks, manage team, view analytics' :
                     'HR access: manage employees, time off, and org settings'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
                Email addresses <span style={{ color: 'var(--muted)', fontWeight: 500 }}>(comma-separated, optional)</span>
              </label>
              <textarea
                value={inviteEmails}
                onChange={e => setInviteEmails(e.target.value)}
                placeholder="alice@company.com, bob@company.com"
                rows={3}
                style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                You can skip this and invite team members later from <strong>HR → Employees</strong>.
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
          <button
            type="button" className="btn btnGhost"
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
          >
            ← Back
          </button>

          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 20 : 7, height: 7, borderRadius: 999,
                background: i < step ? '#22c55e' : i === step ? 'var(--primary)' : 'var(--border)',
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btnPrimary" onClick={() => setStep(s => s + 1)}>
              Next →
            </button>
          ) : (
            <button
              type="button" className="btn btnPrimary"
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending}
            >
              {saveM.isPending ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                  Setting up…
                </span>
              ) : '🚀 Launch Workspace'}
            </button>
          )}
        </div>
      </div>

      {/* Help tip */}
      <div style={{ padding: '14px 20px', borderRadius: 14, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
          You can change all of these settings later from <strong style={{ color: 'var(--text)' }}>Settings → Organization</strong>. This wizard just gives you a head start.
        </div>
      </div>
    </div>
  )
}
