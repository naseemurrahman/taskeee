import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'

const PLANS = [
  { value: 'basic', label: 'Basic', description: 'Up to 10 employees — Free' },
  { value: 'pro', label: 'Pro', description: 'Up to 50 employees — $9/mo' },
  { value: 'enterprise', label: 'Enterprise', description: 'Unlimited — Contact us' },
]

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1>(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [plan, setPlan] = useState('basic')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  function autoSlug(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  }

  const slugOk = /^[a-z0-9-]{3,50}$/.test(orgSlug.trim())
  const step0Ok = fullName.trim().length >= 2 && email.includes('@') && password.length >= 8
  const step1Ok = orgName.trim().length >= 2 && slugOk

  const pwStrength = useMemo(() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8) s++
    if (password.length >= 12) s++
    if (/[A-Z]/.test(password)) s++
    if (/[0-9]/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    return s
  }, [password])

  const pwColor = ['', '#ef4444', '#f97316', 'rgb(243,178,57)', '#22c55e', '#22c55e'][pwStrength]
  const pwLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Strong'][pwStrength]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 0) { if (step0Ok) setStep(1); return }
    setError(null); setLoading(true)
    try {
      await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        json: { fullName, email, password, organizationName: orgName, organizationSlug: orgSlug, plan, seats: 1 },
      })
      setDone(true)
      setTimeout(() => navigate('/signin', { replace: true }), 2500)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message.toLowerCase().includes('email') || err.status === 409) setStep(0)
        setError(err.message)
      } else setError('Sign up failed. Please try again.')
    } finally { setLoading(false) }
  }

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: 32 }}>
        <div style={{ fontSize: 52, marginBottom: 20 }}>🎉</div>
        <div style={{ fontSize: 24, fontWeight: 950, color: '#f0ede6', letterSpacing: '-0.8px', marginBottom: 10 }}>Account created!</div>
        <div style={{ color: '#9a9fad', fontSize: 14, marginBottom: 28 }}>Redirecting you to sign in…</div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'rgb(243,178,57)', borderRadius: 2, width: '100%', animation: 'shimmer 2.4s ease' }} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="authPageV4">
      {/* Left panel */}
      <div className="authV4Left">
        <div className="authV4LeftInner">
          <div className="authV4Logo">
            <div className="authV4LogoMark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="authV4BrandName">TaskFlow Pro</span>
          </div>

          <h2 className="authV4LeftTitle">
            Set up your<br/>
            <span className="authV4Accent">organization</span>
          </h2>
          <p className="authV4LeftSub">Create your workspace and invite your team. It only takes 2 minutes.</p>

          <div className="authV4Features">
            {[
              { step: '01', title: 'Create account', done: step >= 1 },
              { step: '02', title: 'Set up organization', done: false },
              { step: '03', title: 'Invite team', done: false },
            ].map((s, i) => (
              <div key={s.step} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: i > step ? 0.4 : 1, transition: 'opacity 0.3s',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: s.done ? 'rgba(34,197,94,0.15)' : i === step ? 'rgba(243,178,57,0.15)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${s.done ? 'rgba(34,197,94,0.3)' : i === step ? 'rgba(243,178,57,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  color: s.done ? '#22c55e' : i === step ? 'rgb(243,178,57)' : '#5a6070',
                  fontSize: 11, fontWeight: 900,
                }}>
                  {s.done ? '✓' : s.step}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: i === step ? '#f0ede6' : '#9a9fad' }}>
                  {s.title}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 36, padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', fontSize: 12, color: '#5a6070', lineHeight: 1.6 }}>
            Free plan · No credit card required · Cancel anytime
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="authV4Right">
        <div className="authV4Card">
          <div className="authV4CardLogo">
            <div className="authV4LogoMark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span style={{ fontWeight: 950, fontSize: 14, color: '#f0ede6' }}>TaskFlow Pro</span>
          </div>

          {/* Step indicator */}
          <div className="authV4Steps">
            <div className={`authV4Step ${step >= 0 ? 'authV4StepActive' : ''}`} />
            <div className={`authV4Step ${step >= 1 ? 'authV4StepActive' : ''}`} />
          </div>

          <h1 className="authV4Title">{step === 0 ? 'Your details' : 'Your organization'}</h1>
          <p className="authV4Sub">{step === 0 ? 'Create your admin account.' : 'Set up your workspace URL.'}</p>

          {error && (
            <div className="alertV4 alertV4Error" style={{ marginBottom: 16 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
            {step === 0 ? (
              <>
                <Input label="Full Name" required placeholder="Your full name"
                  value={fullName} onChange={e => setFullName(e.target.value)} autoFocus
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                />
                <Input label="Work Email" type="email" required placeholder="you@company.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
                />
                <div>
                  <Input label="Password" type="password" required placeholder="Min. 8 characters"
                    value={password} onChange={e => setPassword(e.target.value)}
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                  />
                  {password && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {[1,2,3,4,5].map(i => (
                          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= pwStrength ? pwColor : 'rgba(255,255,255,0.08)', transition: 'background 0.2s' }} />
                        ))}
                      </div>
                      {pwLabel && <div style={{ fontSize: 11, color: pwColor, marginTop: 4, fontWeight: 700 }}>{pwLabel} password</div>}
                    </div>
                  )}
                </div>
                <button type="submit" className="authV4SubmitBtn" disabled={!step0Ok}>
                  Continue →
                </button>
              </>
            ) : (
              <>
                <Input label="Organization Name" required placeholder="Acme Corp"
                  value={orgName} autoFocus
                  onChange={e => { setOrgName(e.target.value); if (!slugEdited) setOrgSlug(autoSlug(e.target.value)) }}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
                />
                <div>
                  <Input label="Organization Slug" required
                    value={orgSlug}
                    prefix="taskflow.app/"
                    placeholder="acme-corp"
                    onFocus={() => setSlugEdited(true)}
                    onChange={e => { setSlugEdited(true); setOrgSlug(autoSlug(e.target.value)) }}
                    hint={slugOk ? '✓ Looks good' : 'Lowercase letters, numbers, hyphens (3–50 chars)'}
                  />
                </div>
                <Select label="Plan" value={plan} onChange={setPlan} options={PLANS} />
                <div style={{ display: 'grid', gap: 8 }}>
                  <button type="submit" className="authV4SubmitBtn" disabled={!step1Ok || loading}>
                    {loading ? 'Creating account…' : 'Create Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep(0); setError(null) }}
                    style={{ height: 42, borderRadius: 12, background: 'none', border: '1px solid rgba(255,255,255,0.10)', color: '#9a9fad', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ← Back
                  </button>
                </div>
              </>
            )}
          </form>

          <div className="authV4Footer">
            Already have an account? <Link to="/signin" className="authV4FooterLink">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
