import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser } from '../state/auth'

async function signUp(data: {
  fullName: string; email: string; password: string
  orgName: string; orgSlug: string; plan: string
}) {
  return apiFetch<{
    accessToken: string; refreshToken: string
    user: { id: string; email: string; fullName: string; role: string; orgId: string }
  }>('/api/v1/auth/register', { method: 'POST', json: data })
}

const PLANS = [
  { value: 'basic', label: 'Starter', desc: 'Up to 10 members', price: 'Free', color: '#38bdf8' },
  { value: 'pro', label: 'Professional', desc: 'Up to 50 members', price: '$12/seat', color: '#e2ab41', popular: true },
  { value: 'enterprise', label: 'Enterprise', desc: 'Unlimited', price: 'Custom', color: '#8B5CF6' },
]

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [plan, setPlan] = useState('basic')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function autoSlug(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  }

  const slugOk = /^[a-z0-9-]{3,50}$/.test(orgSlug.trim())
  const step0Ok = fullName.trim().length >= 2 && email.includes('@') && password.length >= 8
  const step1Ok = orgName.trim().length >= 2 && slugOk

  const pwStrength = useMemo(() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8) s++; if (password.length >= 12) s++
    if (/[A-Z]/.test(password)) s++; if (/\d/.test(password)) s++
    if (/[^a-zA-Z0-9]/.test(password)) s++
    return s
  }, [password])
  const pwColor = pwStrength <= 1 ? '#ef4444' : pwStrength <= 3 ? '#f59e0b' : '#22c55e'
  const pwLabel = pwStrength <= 1 ? 'Weak' : pwStrength <= 3 ? 'Fair' : 'Strong'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 0) { if (step0Ok) setStep(1); return }
    if (step === 1) { if (step1Ok) setStep(2); return }
    setError(null); setLoading(true)
    try {
      const data = await signUp({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password, orgName: orgName.trim(), orgSlug: orgSlug.trim(), plan })
      setAccessToken(data.accessToken); setRefreshToken(data.refreshToken); setUser(data.user)
      navigate('/app/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.')
      setStep(1)
    } finally { setLoading(false) }
  }

  const STEP_LABELS = ['Your Account', 'Your Organization', 'Choose Plan']

  return (
    <div className="suGrid" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#0a0a10' }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .authInput{width:100%;padding:13px 44px 13px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:15px;outline:none;transition:all 0.15s;box-sizing:border-box}
        .authInput:focus{border-color:#e2ab41;box-shadow:0 0 0 3px rgba(226,171,65,0.15)}
        .authInput::placeholder{color:rgba(255,255,255,0.35)}
        .authSubmit{width:100%;padding:14px;border-radius:12px;border:none;background:#e2ab41;color:#000;font-size:16px;font-weight:900;cursor:pointer;transition:all 0.15s}
        .authSubmit:hover:not(:disabled){background:#f0bc52;transform:translateY(-1px);box-shadow:0 8px 24px rgba(226,171,65,0.35)}
        .authSubmit:disabled{opacity:0.6;cursor:not-allowed}
        @media(max-width:980px){.suGrid{grid-template-columns:1fr!important}.suLeft{display:none!important}.suRight{padding:24px 20px!important;min-height:100vh}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      `}</style>

      {/* Left panel */}
      <div className="suLeft" style={{ padding: '48px 52px', background: 'linear-gradient(160deg, #0f1018 0%, #13111f 50%, #0f1018 100%)', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)', top: -100, right: -100 }} />
        <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', display: 'grid', gap: 34 }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
            <div style={{ width: 40, height: 40, borderRadius: 13, background: 'linear-gradient(135deg, #e2ab41, #f59e0b)', display: 'grid', placeItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span style={{ fontWeight: 950, fontSize: 20, color: '#fff', letterSpacing: '-0.5px' }}>TaskFlow Pro</span>
          </Link>

        <div>
          <div style={{ fontSize: 13, color: '#e2ab41', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Trusted by 500+ organizations</div>
          <h1 style={{ fontSize: 'clamp(26px,2.5vw,40px)', fontWeight: 950, letterSpacing: '-1px', color: '#fff', lineHeight: 1.15, margin: '0 0 20px' }}>
            Start managing smarter<br />in under <span style={{ color: '#e2ab41' }}>5 minutes</span>
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, maxWidth: 360, marginBottom: 32 }}>
            Set up your organization, invite your team, and start assigning tasks with AI-assisted workflows — all from one platform.
          </p>

          {/* Step preview */}
          <div style={{ display: 'grid', gap: 12 }}>
            {[['1', 'Create your admin account', step >= 1], ['2', 'Name your organization', step >= 2], ['3', 'Choose your plan', false]].map(([n, label, done]) => (
              <div key={n as string} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: (done as boolean) ? '#22c55e' : 'rgba(255,255,255,0.1)', border: `1.5px solid ${(done as boolean) ? '#22c55e' : 'rgba(255,255,255,0.15)'}`, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                  {(done as boolean) ? '✓' : n}
                </div>
                <span style={{ fontSize: 13, color: (done as boolean) ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{label as string}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div style={{ padding: '20px 24px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: 14 }}>
            "TaskFlow Pro cut our project delivery time by 35%. The AI insights flag at-risk tasks before they become real problems."
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #e2ab41, #8B5CF6)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 900, color: '#fff' }}>S</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Sarah Al-Rashid</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>VP Engineering · Horizon Tech</div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="suRight" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 60px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 420, animation: 'fadeIn 0.4s ease' }}>
          {/* Steps */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 36 }}>
            {STEP_LABELS.map((label, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ height: 3, borderRadius: 999, background: i <= step ? '#e2ab41' : 'rgba(255,255,255,0.10)', transition: 'background 0.3s' }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: i === step ? '#e2ab41' : 'rgba(255,255,255,0.3)', transition: 'color 0.3s', textAlign: 'center' }}>{label}</div>
              </div>
            ))}
          </div>

          {error && <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 20, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 14, fontWeight: 600 }}>{error}</div>}

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
            {/* Step 0: Account */}
            {step === 0 && (
              <>
                <div><div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', marginBottom: 4 }}>Create your account</div><div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>You'll be the admin of your organization</div></div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Full Name</label>
                  <input className="authInput" style={{ paddingRight: 16 }} type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Sarah Johnson" autoComplete="name" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Work Email</label>
                  <input className="authInput" style={{ paddingRight: 16 }} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input className="authInput" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                  </div>
                  {password && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(pwStrength / 5) * 100}%`, background: pwColor, borderRadius: 999, transition: 'all 0.3s' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: pwColor }}>{pwLabel}</span>
                  </div>}
                </div>
              </>
            )}

            {/* Step 1: Organization */}
            {step === 1 && (
              <>
                <div><div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', marginBottom: 4 }}>Name your workspace</div><div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>This is how your team will know it</div></div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Organization Name</label>
                  <input className="authInput" style={{ paddingRight: 16 }} type="text" value={orgName} onChange={e => { setOrgName(e.target.value); if (!slugEdited) setOrgSlug(autoSlug(e.target.value)) }} placeholder="Acme Corp" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workspace URL</label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 14, color: 'rgba(255,255,255,0.35)', fontSize: 14, pointerEvents: 'none', whiteSpace: 'nowrap' }}>app.taskflow.pro/</span>
                    <input className="authInput" style={{ paddingLeft: 150, paddingRight: 16 }} type="text" value={orgSlug} onChange={e => { setOrgSlug(autoSlug(e.target.value)); setSlugEdited(true) }} placeholder="acme-corp" />
                  </div>
                  {orgSlug && <div style={{ marginTop: 6, fontSize: 11, color: slugOk ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{slugOk ? '✓ Valid URL' : '✗ 3-50 lowercase letters, numbers, hyphens only'}</div>}
                </div>
              </>
            )}

            {/* Step 2: Plan */}
            {step === 2 && (
              <>
                <div><div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', marginBottom: 4 }}>Choose your plan</div><div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>You can upgrade anytime</div></div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {PLANS.map(p => (
                    <div key={p.value} onClick={() => setPlan(p.value)} style={{ padding: '16px 18px', borderRadius: 14, border: `2px solid ${plan === p.value ? p.color : 'rgba(255,255,255,0.10)'}`, background: plan === p.value ? p.color + '10' : 'rgba(255,255,255,0.03)', cursor: 'pointer', position: 'relative', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      {p.popular && <div style={{ position: 'absolute', top: -10, right: 16, background: p.color, color: '#000', fontSize: 9, fontWeight: 900, padding: '2px 10px', borderRadius: 999, letterSpacing: '0.08em' }}>POPULAR</div>}
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 15, color: '#fff', marginBottom: 2 }}>{p.label}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{p.desc}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, fontSize: 16, color: p.color }}>{p.price}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button type="submit" className="authSubmit" disabled={loading || (step === 0 && !step0Ok) || (step === 1 && !step1Ok)}>
              {loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 0.8s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                  Creating workspace…
                </span>
              ) : step < 2 ? 'Continue →' : '🚀 Create My Workspace'}
            </button>
            {step > 0 && <button type="button" onClick={() => { setStep(s => (s - 1) as 0|1|2); setError(null) }} style={{ background: 'none', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 12, color: 'rgba(255,255,255,0.6)', padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>← Back</button>}
          </form>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Already have an account? </span>
            <Link to="/signin" style={{ fontSize: 13, color: '#e2ab41', fontWeight: 700, textDecoration: 'none' }}>Sign in</Link>
          </div>
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
            By creating an account you agree to our Terms of Service and Privacy Policy
          </div>
        </div>
      </div>
    </div>
  )
}
