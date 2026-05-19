import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser } from '../state/auth'
import { getMktTheme } from '../lib/mktTheme'

const PLANS = [
  { value: 'basic', label: 'Starter', desc: 'Core task management, up to 10 members', price: 'Free', color: '#38bdf8' },
  { value: 'pro', label: 'Professional', desc: 'JecZone AI + analytics + WhatsApp', price: '$12/seat', color: '#e2ab41' },
  { value: 'enterprise', label: 'Enterprise', desc: 'Custom workflows, SSO, dedicated support', price: 'Custom', color: '#8b5cf6' },
]

async function createWorkspace(data: {
  fullName: string; email: string; password: string
  organizationName: string; organizationSlug: string; plan: string; seats: number
}) {
  return apiFetch<{ accessToken: string; refreshToken: string; user: { id: string; email: string; fullName: string; role: string; orgId: string } }>(
    '/api/v1/auth/signup', { method: 'POST', json: data, timeoutMs: 60_000 }
  )
}

function autoSlug(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string; error?: string; isDark: boolean }) {
  const [show, setShow] = useState(false)
  const isPassword = props.type === 'password'
  const inputType = isPassword ? (show ? 'text' : 'password') : (props.type || 'text')
  const bg = props.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
  const border = props.error ? '1px solid rgba(239,68,68,0.6)' : (props.isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.12)')
  const textColor = props.isDark ? '#ffffff' : '#0f0f0e'
  const labelColor = props.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)'
  const eyeColor = props.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  return (
    <label style={{ display:'grid', gap:7 }}>
      <span style={{ color:labelColor, textTransform:'uppercase', fontSize:11, fontWeight:800, letterSpacing:'.08em' }}>{props.label}</span>
      <div style={{ position:'relative' }}>
        <input value={props.value} onChange={e => props.onChange(e.target.value)} placeholder={props.placeholder} type={inputType} autoComplete={props.autoComplete}
          style={{ width:'100%', height:50, borderRadius:11, border, background:bg, color:textColor, outline:'none', padding: isPassword ? '0 44px 0 14px' : '0 14px', fontSize:15, fontFamily:'inherit', transition:'border 0.15s' }}
          onFocus={e => (e.target.style.borderColor = 'rgba(226,171,65,0.55)')}
          onBlur={e => (e.target.style.borderColor = props.error ? 'rgba(239,68,68,0.6)' : (props.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'))} />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)} style={{ position:'absolute', right:13, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:eyeColor, display:'flex', alignItems:'center', padding:0 }}>
            {show
              ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        )}
      </div>
      {props.error && <span style={{ color:'rgba(239,68,68,0.9)', fontSize:12 }}>{props.error}</span>}
    </label>
  )
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [plan, setPlan] = useState('basic')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const theme = getMktTheme()
  const isDark = theme === 'dark'

  const bg = isDark ? '#060810' : '#f8f8f6'
  const cardBg = isDark ? '#0b0f1b' : '#ffffff'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  const textColor = isDark ? '#ffffff' : '#0f0f0e'
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)'

  const passwordChecks = useMemo(() => [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', ok: /[a-z]/.test(password) },
    { label: 'Number', ok: /\d/.test(password) },
    { label: 'Special character', ok: /[^a-zA-Z0-9]/.test(password) },
  ], [password])

  const passwordOk = passwordChecks.every(c => c.ok)
  const step0Ok = fullName.trim().length >= 2 && email.includes('@') && passwordOk && password === confirmPw
  const step1Ok = organizationName.trim().length >= 2 && organizationSlug.length >= 3

  const STEPS = [
    { title: 'Create your account', sub: <>Already have an account? <Link to="/signin" style={{ color:'#e2ab41', textDecoration:'none', fontWeight:700 }}>Sign in</Link></> },
    { title: 'Name your workspace', sub: 'Your organization is automatically configured and isolated.' },
    { title: 'Choose your plan', sub: 'You can upgrade or downgrade anytime from your billing settings.' },
  ]

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (step === 0) {
      if (!step0Ok) { setError('Complete all fields and meet the password requirements.'); return }
      setStep(1); return
    }
    if (step === 1) {
      if (!step1Ok) { setError('Enter your organization name (at least 2 characters).'); return }
      setStep(2); return
    }
    setLoading(true)
    try {
      const result = await createWorkspace({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password, organizationName: organizationName.trim(), organizationSlug: organizationSlug.trim().toLowerCase(), plan, seats: 1 })
      setAccessToken(result.accessToken); setRefreshToken(result.refreshToken); setUser(result.user)
      navigate('/app/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your workspace. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        .su-input:focus{border-color:rgba(226,171,65,0.55)!important;box-shadow:0 0 0 3px rgba(226,171,65,0.1)!important}
        @keyframes su-fade{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .su-animate{animation:su-fade 0.4s ease both}
      `}</style>
      <div style={{ minHeight:'100vh', background:bg, display:'grid', placeItems:'center', padding:24, fontFamily:"'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div style={{ width:'100%', maxWidth:480 }}>
          {/* Header */}
          <div style={{ textAlign:'center', marginBottom:28 }}>
            <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:10, textDecoration:'none', marginBottom:6 }}>
              <div style={{ width:36, height:36, borderRadius:10, background: isDark?'linear-gradient(135deg,#1c1710,#0d0b08)':'linear-gradient(135deg,#fff8ec,#fef3dc)', border:'1.5px solid rgba(226,171,65,0.4)', display:'grid', placeItems:'center' }}>
                <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="sulg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs><rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#sulg)"/><rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#sulg)"/></svg>
              </div>
              <span style={{ fontWeight:950, fontSize:14, letterSpacing:'0.13em', textTransform:'uppercase', background:'linear-gradient(135deg,#f9e6a2,#e2ab41)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>TASKEE</span>
            </Link>
          </div>

          {/* Card */}
          <div className="su-animate" style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:20, padding:'32px 28px', boxShadow: isDark?'0 24px 80px rgba(0,0,0,0.35)':'0 8px 40px rgba(0,0,0,0.08)' }}>
            {/* Step indicator */}
            <div style={{ display:'flex', gap:6, marginBottom:28 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ flex:1, height:3, borderRadius:99, background: i <= step ? 'linear-gradient(90deg,#c98317,#e2ab41)' : (isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'), transition:'background 0.3s' }} />
              ))}
            </div>

            <div style={{ marginBottom:24 }}>
              <div style={{ color:'rgba(226,171,65,0.8)', textTransform:'uppercase', fontSize:11, fontWeight:800, letterSpacing:'.12em', marginBottom:6 }}>Step {step + 1} of 3</div>
              <h1 style={{ margin:'0 0 6px', fontSize:26, fontWeight:950, letterSpacing:'-0.5px', color:textColor, lineHeight:1.1 }}>{STEPS[step].title}</h1>
              <p style={{ margin:0, color:mutedColor, fontSize:14 }}>{STEPS[step].sub}</p>
            </div>

            {error && <div style={{ marginBottom:18, padding:'12px 14px', borderRadius:11, background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', fontSize:14 }}>{error}</div>}

            <form onSubmit={onSubmit}>
              <div style={{ display:'grid', gap:14 }}>
                {step === 0 && <>
                  <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Admin User" autoComplete="name" isDark={isDark} />
                  <Field label="Work email" value={email} onChange={setEmail} placeholder="you@company.com" type="email" autoComplete="email" isDark={isDark} />
                  <Field label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" autoComplete="new-password" isDark={isDark} />
                  {password && (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                      {passwordChecks.map(c => (
                        <span key={c.label} style={{ fontSize:12, color: c.ok ? '#4ade80' : mutedColor, display:'flex', alignItems:'center', gap:5 }}>
                          {c.ok ? '✓' : '○'} {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <Field label="Confirm password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat password" type="password" autoComplete="new-password" isDark={isDark} error={confirmPw.length > 0 && confirmPw !== password ? 'Passwords do not match' : undefined} />
                </>}

                {step === 1 && <>
                  <Field label="Organization / Company Name" value={organizationName} onChange={v => { setOrganizationName(v); setOrganizationSlug(autoSlug(v)) }} placeholder="Almalath Technologies" isDark={isDark} />
                  {organizationSlug && (
                    <div style={{ fontSize:12.5, color: isDark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.4)', marginTop:-6 }}>
                      Workspace URL: <span style={{ color:'rgba(226,171,65,0.85)', fontWeight:700 }}>taskee.io/{organizationSlug}</span>
                    </div>
                  )}
                </>}

                {step === 2 && (
                  <div style={{ display:'grid', gap:10 }}>
                    {PLANS.map(item => (
                      <button key={item.value} type="button" onClick={() => setPlan(item.value)} style={{ textAlign:'left', padding:16, borderRadius:13, border: plan === item.value ? `1.5px solid rgba(226,171,65,0.7)` : `1px solid ${isDark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.10)'}`, background: plan === item.value ? 'rgba(226,171,65,0.10)' : (isDark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.02)'), color:textColor, cursor:'pointer', transition:'all 0.15s' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', gap:16, marginBottom:4 }}>
                          <strong style={{ fontSize:14, fontWeight:800 }}>{item.label}</strong>
                          <strong style={{ color: item.color, fontSize:13, fontWeight:800 }}>{item.price}</strong>
                        </div>
                        <div style={{ color:mutedColor, fontSize:13 }}>{item.desc}</div>
                      </button>
                    ))}
                  </div>
                )}

                <button type="submit" disabled={loading || (step === 0 && !step0Ok) || (step === 1 && !step1Ok)}
                  style={{ height:52, borderRadius:12, border:0, background:'linear-gradient(135deg,#c98317,#e2ab41,#f4ca57)', color:'#090909', fontWeight:900, cursor: loading ? 'wait' : 'pointer', opacity: (loading || (step === 0 && !step0Ok) || (step === 1 && !step1Ok)) ? 0.65 : 1, fontSize:15, fontFamily:'inherit', transition:'all 0.15s' }}>
                  {loading ? 'Creating workspace…' : step === 2 ? 'Create admin account →' : 'Continue →'}
                </button>

                {step > 0 && (
                  <button type="button" onClick={() => setStep((step - 1) as 0 | 1)}
                    style={{ height:46, borderRadius:12, border:`1px solid ${isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`, background:'transparent', color:mutedColor, fontWeight:700, cursor:'pointer', fontSize:14, fontFamily:'inherit' }}>
                    ← Back
                  </button>
                )}
              </div>
            </form>
          </div>

          <div style={{ textAlign:'center', marginTop:20, fontSize:13, color:isDark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.3)' }}>
            By signing up, you agree to our{' '}
            <span style={{ fontWeight:600 }}>Terms of Service</span> and{' '}
            <span style={{ fontWeight:600 }}>Privacy Policy</span>.
          </div>
        </div>
      </div>
    </>
  )
}
