import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

type SignupResponse = {
  message: string
  user: { id: string; email: string; fullName: string; emailVerified: boolean }
}

const STEPS = ['Account', 'Organization'] as const
type Step = 0 | 1

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  function autoSlug(name: string) {
    return name.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
  }

  const slugOk = /^[a-z0-9-]{3,50}$/.test(organizationSlug.trim())
  const step0Ok = fullName.trim().length >= 2 && email.trim().includes('@') && password.length >= 8
  const step1Ok = organizationName.trim().length >= 2 && slugOk
  // canSubmit = step0Ok && step1Ok

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

  const pwColor = ['transparent', '#ef4444', '#f97316', '#f4ca57', '#10b981', '#10b981'][pwStrength]
  const pwLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Strong'][pwStrength]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 0) { setStep(1); return }
    setError(null)
    setLoading(true)
    try {
      await apiFetch<SignupResponse>('/api/v1/auth/signup', {
        method: 'POST',
        json: {
          fullName, email, password,
          organizationName, organizationSlug,
          plan: 'basic', seats: 1,
        },
      })
      setSuccess(true)
      setTimeout(() => navigate('/signin', { replace: true }), 2000)
    } catch (err) {
      if (err instanceof ApiError) {
        // If email already exists, bring back to step 0
        if (err.message.toLowerCase().includes('email') || err.status === 409) {
          setStep(0)
        }
        setError(err.message)
      } else {
        setError('Sign up failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="authShellV2" style={{ gridTemplateColumns: '1fr' }}>
        <div className="authShellV2Right" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🎉</div>
            <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: '-0.8px', marginBottom: 10 }}>
              Account created!
            </div>
            <div style={{ color: 'var(--text2)', marginBottom: 24 }}>
              Redirecting you to sign in…
            </div>
            <div style={{ width: 200, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, margin: '0 auto' }}>
              <div style={{ height: '100%', width: '100%', background: '#10b981', borderRadius: 2, animation: 'shimmer 2s ease infinite' }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="authShellV2">
      {/* Left panel */}
      <div className="authShellV2Left">
        <div className="authV2Showcase animate-fadeInUp">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <div className="authV2LogoMark">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>TaskFlow Pro</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>HR + Workflows + AI</div>
            </div>
          </div>

          <h2 className="authV2ShowcaseTitle">
            Set up your<br />
            <span style={{ background: 'linear-gradient(135deg, #f4ca57, #6d5efc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              organization
            </span>
          </h2>
          <p className="authV2ShowcaseText" style={{ marginTop: 14 }}>
            Create your workspace and invite your team. Role-based access, AI approvals, and HR automation — all in one place.
          </p>

          <div style={{ marginTop: 32, display: 'grid', gap: 14 }}>
            {[
              { step: '01', title: 'Create your account', done: step >= 1 },
              { step: '02', title: 'Set up your organization', done: false },
              { step: '03', title: 'Invite your team', done: false },
            ].map((s, i) => (
              <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: i > step ? 0.4 : 1, transition: 'opacity 0.3s' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: s.done ? 'rgba(16,185,129,0.15)' : i === step ? 'rgba(244,202,87,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${s.done ? 'rgba(16,185,129,0.3)' : i === step ? 'rgba(244,202,87,0.3)' : 'rgba(255,255,255,0.10)'}`,
                  display: 'grid', placeItems: 'center',
                  color: s.done ? '#10b981' : i === step ? '#f4ca57' : 'var(--muted)',
                  fontSize: 12, fontWeight: 900,
                }}>
                  {s.done ? '✓' : s.step}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: i === step ? 'var(--text)' : 'var(--text2)' }}>
                  {s.title}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 32, padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Free plan · No credit card required · Cancel anytime
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="authShellV2Right">
        <div className="authV2Card animate-fadeInUp">

          {/* Logo */}
          <div className="authV2Logo">
            <div className="authV2LogoMark">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div className="authV2Brand">TaskFlow Pro</div>
              <div className="authV2Tagline">Create your free account</div>
            </div>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  height: 4, borderRadius: 2,
                  width: i === step ? 28 : 16,
                  background: i <= step ? '#f4ca57' : 'rgba(255,255,255,0.12)',
                  transition: 'all 0.3s ease',
                }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: i === step ? '#f4ca57' : 'var(--muted)' }}>{s}</span>
              </div>
            ))}
          </div>

          <h1 className="authV2H1">{step === 0 ? 'Your details' : 'Your organization'}</h1>
          <p className="authV2Sub">
            {step === 0 ? 'Create your admin account.' : 'Set up your workspace — you can change this later.'}
          </p>

          {error && (
            <div className="authV2Error animate-fadeIn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit}>
            {step === 0 ? (
              <>
                <div className="authV2Field">
                  <label className="authV2Label" htmlFor="fullName">Full name</label>
                  <input
                    id="fullName"
                    className="authV2Input"
                    placeholder="Your full name"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="authV2Field">
                  <label className="authV2Label" htmlFor="email">Work email</label>
                  <input
                    id="email"
                    className="authV2Input"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="authV2Field">
                  <label className="authV2Label" htmlFor="password">Password</label>
                  <div className="authV2InputWrap">
                    <input
                      id="password"
                      className="authV2Input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button type="button" className="authV2ShowPwd" onClick={() => setShowPassword(v => !v)}>
                      {showPassword
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  {password && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {[1,2,3,4,5].map(i => (
                          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= pwStrength ? pwColor : 'rgba(255,255,255,0.08)', transition: 'background 0.2s' }} />
                        ))}
                      </div>
                      {pwLabel && <div style={{ fontSize: 11, color: pwColor, marginTop: 4, fontWeight: 700 }}>{pwLabel}</div>}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="authV2Submit"
                  disabled={!step0Ok}
                >
                  Continue
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                <div className="authV2Field">
                  <label className="authV2Label" htmlFor="orgName">Organization name</label>
                  <input
                    id="orgName"
                    className="authV2Input"
                    placeholder="Acme Corp"
                    value={organizationName}
                    onChange={e => {
                      setOrganizationName(e.target.value)
                      if (!slugEdited) setOrganizationSlug(autoSlug(e.target.value))
                    }}
                    autoFocus
                    required
                  />
                </div>

                <div className="authV2Field">
                  <label className="authV2Label" htmlFor="orgSlug">
                    Organization URL
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>
                      (used in your workspace URL)
                    </span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 13, color: 'var(--muted)', pointerEvents: 'none', whiteSpace: 'nowrap',
                    }}>
                      taskflow.app/
                    </div>
                    <input
                      id="orgSlug"
                      className="authV2Input"
                      style={{ paddingLeft: 104 }}
                      placeholder="acme-corp"
                      value={organizationSlug}
                      onFocus={() => setSlugEdited(true)}
                      onChange={e => { setSlugEdited(true); setOrganizationSlug(autoSlug(e.target.value)) }}
                      required
                    />
                  </div>
                  <div style={{ fontSize: 11, marginTop: 5, color: slugOk ? '#10b981' : organizationSlug ? '#ef4444' : 'var(--muted)', fontWeight: 700 }}>
                    {organizationSlug
                      ? slugOk ? '✓ Looks good' : 'Use only lowercase letters, numbers, and hyphens (3–50 chars)'
                      : 'Lowercase letters, numbers, hyphens — 3 to 50 characters'}
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                  <button
                    type="submit"
                    className="authV2Submit"
                    disabled={!step1Ok || loading}
                  >
                    {loading ? (
                      <>
                        <svg className="animate-rotate" width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.416" strokeDashoffset="10" opacity="0.3"/>
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                        </svg>
                        Creating account…
                      </>
                    ) : (
                      <>
                        Create account
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep(0); setError(null) }}
                    style={{ height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ← Back
                  </button>
                </div>
              </>
            )}
          </form>

          <div className="authV2Links" style={{ justifyContent: 'center', marginTop: 20 }}>
            <span>Already have an account? <Link to="/signin">Sign in</Link></span>
          </div>
        </div>
      </div>
    </div>
  )
}
