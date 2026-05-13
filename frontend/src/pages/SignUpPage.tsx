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
  { value: 'basic',      label: 'Starter',      desc: 'Up to 10 members',  price: 'Free',     color: '#38bdf8' },
  { value: 'pro',        label: 'Professional', desc: 'Up to 50 members',  price: '$12/seat', color: '#e2ab41', popular: true },
  { value: 'enterprise', label: 'Enterprise',   desc: 'Unlimited members', price: 'Custom',   color: '#8b5cf6' },
]

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep]               = useState<0 | 1 | 2>(0)
  const [fullName, setFullName]       = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [showPw, setShowPw]           = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [orgName, setOrgName]         = useState('')
  const [orgSlug, setOrgSlug]         = useState('')
  const [slugEdited, setSlugEdited]   = useState(false)
  const [plan, setPlan]               = useState('basic')
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)

  function autoSlug(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)
  }

  const slugOk  = /^[a-z0-9-]{3,50}$/.test(orgSlug.trim())
  const pwMatch = password === confirmPw
  const step0Ok = fullName.trim().length >= 2 && email.includes('@') && password.length >= 8 && pwMatch && confirmPw.length > 0
  const step1Ok = orgName.trim().length >= 2 && slugOk

  const pwStrength = useMemo(() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8)           s++
    if (password.length >= 12)          s++
    if (/[A-Z]/.test(password))         s++
    if (/\d/.test(password))            s++
    if (/[^a-zA-Z0-9]/.test(password))  s++
    return s
  }, [password])
  const pwColor = pwStrength <= 1 ? '#ef4444' : pwStrength <= 3 ? '#f59e0b' : '#22c55e'
  const pwLabel = pwStrength <= 1 ? 'Weak' : pwStrength <= 3 ? 'Fair' : 'Strong'

  // Password policy checklist — mirrors backend validatePasswordStrength
  const pwChecks = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Uppercase letter (A–Z)',  ok: /[A-Z]/.test(password) },
    { label: 'Lowercase letter (a–z)',  ok: /[a-z]/.test(password) },
    { label: 'Number (0–9)',            ok: /\d/.test(password) },
    { label: 'Special character (!@#$)', ok: /[^a-zA-Z0-9]/.test(password) },
  ]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 0) {
      if (!pwMatch) { setError('Passwords do not match. Please re-enter.'); return }
      if (step0Ok) { setError(null); setStep(1) }
      return
    }
    if (step === 1) { if (step1Ok) { setError(null); setStep(2) } return }
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

  const STEP_LABELS = ['Your Account', 'Organization', 'Choose Plan']

  const EyeBtn = ({ show, toggle }: { show: boolean; toggle: () => void }) => (
    <button type="button" onClick={toggle} aria-label={show ? 'Hide' : 'Show'} style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.3)', display:'grid', placeItems:'center', padding:4, transition:'color 0.12s' }}>
      {show
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      }
    </button>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .su-root{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#060810;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
        .su-left{position:relative;display:flex;flex-direction:column;justify-content:center;padding:48px 64px;background:linear-gradient(150deg,#08091a 0%,#0c0f24 60%,#09111e 100%);border-right:1px solid rgba(255,255,255,0.05);overflow:hidden}
        .su-right{display:flex;align-items:center;justify-content:center;padding:36px 48px;overflow-y:auto}
        .su-orb{position:absolute;border-radius:50%;pointer-events:none;filter:blur(80px)}
        .su-input{width:100%;height:50px;padding:0 48px 0 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:12px;color:#fff;font-size:15px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:500;outline:none;transition:all 0.15s}
        .su-input:focus{border-color:rgba(226,171,65,0.6);box-shadow:0 0 0 3px rgba(226,171,65,0.1);background:rgba(255,255,255,0.06)}
        .su-input::placeholder{color:rgba(255,255,255,0.22)}
        .su-input-sm{padding-right:16px}
        .su-input-err{border-color:rgba(239,68,68,0.5)!important}
        .su-input-ok{border-color:rgba(34,197,94,0.4)!important}
        .su-label{display:block;font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:8px}
        .su-btn{width:100%;height:52px;border:none;border-radius:12px;background:linear-gradient(135deg,#c98317,#e2ab41,#f4ca57);color:#0a0800;font-size:15px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:800;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:8px}
        .su-btn:hover:not(:disabled){box-shadow:0 8px 32px rgba(226,171,65,0.35),0 2px 8px rgba(0,0,0,0.3);transform:translateY(-1px)}
        .su-btn:active:not(:disabled){transform:translateY(0);box-shadow:none}
        .su-btn:disabled{opacity:0.45;cursor:not-allowed;transform:none}
        .su-btn-ghost{width:100%;height:44px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:transparent;color:rgba(255,255,255,0.45);font-size:14px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:700;cursor:pointer;transition:all 0.15s}
        .su-btn-ghost:hover{border-color:rgba(255,255,255,0.2);color:#fff;background:rgba(255,255,255,0.04)}
        .su-err{padding:13px 16px;border-radius:10px;background:rgba(239,68,68,0.09);border:1px solid rgba(239,68,68,0.25);color:#f87171;font-size:13.5px;font-weight:600;display:flex;gap:10px;align-items:flex-start;margin-bottom:20px}
        .su-plan{width:100%;border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 18px;cursor:pointer;transition:all 0.15s;background:rgba(255,255,255,0.03);text-align:left}
        .su-plan:hover{border-color:rgba(255,255,255,0.16);background:rgba(255,255,255,0.05)}
        .su-plan-sel{background:rgba(226,171,65,0.07)!important;border-color:rgba(226,171,65,0.4)!important}
        .su-progress{display:flex;gap:6px;margin-bottom:32px}
        .su-progress-dot{flex:1;height:3px;border-radius:2px;transition:background 0.3s}
        @keyframes su-fade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .su-fade{animation:su-fade 0.35s ease forwards}
        @keyframes su-spin{to{transform:rotate(360deg)}}
        @media(max-width:860px){.su-root{grid-template-columns:1fr}.su-left{display:none}.su-right{padding:32px 24px;min-height:100vh;align-items:flex-start;padding-top:48px}}
        @media(max-width:400px){.su-right{padding:24px 16px;padding-top:32px}}
      `}</style>

      <div className="su-root">
        {/* Left panel */}
        <div className="su-left">
          <div className="su-orb" style={{ width:500, height:500, background:'rgba(226,171,65,0.08)', top:-150, right:-120 }} />
          <div className="su-orb" style={{ width:350, height:350, background:'rgba(99,102,241,0.07)', bottom:-80, left:-60 }} />
          <div style={{ position:'relative', zIndex:1, maxWidth:460 }}>
            <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:11, textDecoration:'none', marginBottom:56 }}>
              <div style={{ width:38, height:38, borderRadius:10, background:'linear-gradient(135deg,#1c1710,#0d0b08)', border:'1.5px solid rgba(226,171,65,0.4)', display:'grid', placeItems:'center', boxShadow:'0 4px 18px rgba(226,171,65,0.18)' }}>
                <svg width="19" height="19" viewBox="0 0 48 48" fill="none">
                  <defs><linearGradient id="sulg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs>
                  <rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#sulg)"/>
                  <rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#sulg)"/>
                </svg>
              </div>
              <span style={{ fontWeight:900, fontSize:14, letterSpacing:'0.14em', textTransform:'uppercase', background:'linear-gradient(135deg,#f9e6a2,#e2ab41)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>TASKEE</span>
            </Link>
            <h1 style={{ fontSize:'clamp(28px,3vw,42px)', fontWeight:950, letterSpacing:'-1.2px', color:'#fff', lineHeight:1.08, marginBottom:14 }}>
              Build your<br /><span style={{ color:'#e2ab41' }}>organization&apos;s</span><br />command center.
            </h1>
            <p style={{ fontSize:14.5, color:'rgba(255,255,255,0.42)', lineHeight:1.75, marginBottom:44, maxWidth:340 }}>
              One platform for task management, HR workflows, AI approvals, and team performance — all role-aware.
            </p>
            <div style={{ display:'grid', gap:11, marginBottom:44 }}>
              {['Free 14-day trial on all plans','No credit card required to start','Import your team in under 5 minutes','Cancel anytime — no questions asked'].map(t => (
                <div key={t} style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:'rgba(34,197,94,0.14)', border:'1px solid rgba(34,197,94,0.3)', display:'grid', placeItems:'center', flexShrink:0 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span style={{ fontSize:13.5, color:'rgba(255,255,255,0.55)', fontWeight:500 }}>{t}</span>
                </div>
              ))}
            </div>
            <div style={{ paddingTop:28, borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ display:'flex' }}>
                {['#e2ab41','#8b5cf6','#38bdf8','#22c55e','#f97316'].map((c,i) => (
                  <div key={i} style={{ width:28, height:28, borderRadius:'50%', background:c+'22', border:`2px solid #060810`, marginLeft:i?-8:0, display:'grid', placeItems:'center', fontSize:10, fontWeight:900, color:c, outline:`1px solid ${c}40` }}>
                    {String.fromCharCode(65+i)}
                  </div>
                ))}
              </div>
              <div style={{ marginLeft:8 }}>
                <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>500+ organizations trust TASKEE</div>
                <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.35)', marginTop:2 }}>Joined in the last 30 days</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="su-right">
          <div style={{ width:'100%', maxWidth:420 }} className="su-fade">
            <div className="su-progress">
              {STEP_LABELS.map((_,i) => (
                <div key={i} className="su-progress-dot" style={{ background: i <= step ? '#e2ab41' : 'rgba(255,255,255,0.1)' }} />
              ))}
            </div>
            <div style={{ marginBottom:28 }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(226,171,65,0.65)', marginBottom:10 }}>
                Step {step+1} of 3 — {STEP_LABELS[step]}
              </div>
              <h2 style={{ fontSize:26, fontWeight:950, color:'#fff', letterSpacing:'-0.7px', marginBottom:6 }}>
                {step===0 ? 'Create your account' : step===1 ? 'Name your workspace' : 'Pick your plan'}
              </h2>
              <p style={{ fontSize:13.5, color:'rgba(255,255,255,0.35)', fontWeight:500 }}>
                {step===0
                  ? <span>Already have one? <Link to="/signin" style={{ color:'#e2ab41', textDecoration:'none', fontWeight:700 }}>Sign in →</Link></span>
                  : step===1 ? 'Your workspace URL: taskee.app/your-slug'
                  : 'All plans include a 14-day trial. No card needed.'}
              </p>
            </div>

            {error && (
              <div className="su-err">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            <form onSubmit={onSubmit} style={{ display:'grid', gap:14 }}>
              {step===0 && (<>
                <div>
                  <label className="su-label">Full Name</label>
                  <input className="su-input su-input-sm" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Sarah Al-Rashid" autoComplete="name" required />
                </div>
                <div>
                  <label className="su-label">Work Email</label>
                  <input className="su-input su-input-sm" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
                </div>
                <div>
                  <label className="su-label">Password</label>
                  <div style={{ position:'relative' }}>
                    <input className={`su-input${password && (pwStrength<=1?' su-input-err':pwStrength>=4?' su-input-ok':'')}`}
                      type={showPw?'text':'password'} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters" autoComplete="new-password" required minLength={8} />
                    <EyeBtn show={showPw} toggle={() => setShowPw(v => !v)} />
                  </div>
                  {password && (
                    <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ flex:1, height:3, borderRadius:2, background:'rgba(255,255,255,0.08)', overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${(pwStrength/5)*100}%`, background:pwColor, borderRadius:2, transition:'all 0.3s' }} />
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:pwColor, minWidth:36 }}>{pwLabel}</span>
                    </div>
                  )}
                  {/* Policy checklist */}
                  {password.length > 0 && (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 16px', marginTop:10, padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                      {pwChecks.map(c => (
                        <div key={c.label} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color: c.ok ? '#4ade80' : 'rgba(255,255,255,0.3)', transition:'color 0.15s' }}>
                          {c.ok
                            ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                            : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="9"/></svg>
                          }
                          {c.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="su-label">Re-enter Password</label>
                  <div style={{ position:'relative' }}>
                    <input className={`su-input${confirmPw&&!pwMatch?' su-input-err':confirmPw&&pwMatch?' su-input-ok':''}`}
                      type={showConfirm?'text':'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Repeat your password" autoComplete="new-password" required />
                    <EyeBtn show={showConfirm} toggle={() => setShowConfirm(v => !v)} />
                  </div>
                  {confirmPw && !pwMatch && <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:7, color:'#f87171', fontSize:12, fontWeight:600 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Passwords don&apos;t match</div>}
                  {confirmPw && pwMatch  && <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:7, color:'#4ade80', fontSize:12, fontWeight:600 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Passwords match</div>}
                </div>
                <button type="submit" className="su-btn" disabled={!step0Ok} style={{ marginTop:4 }}>Continue →</button>
              </>)}

              {step===1 && (<>
                <div>
                  <label className="su-label">Organization Name</label>
                  <input className="su-input su-input-sm" type="text" value={orgName}
                    onChange={e => { setOrgName(e.target.value); if (!slugEdited) setOrgSlug(autoSlug(e.target.value)) }}
                    placeholder="Acme Corp" autoFocus required />
                </div>
                <div>
                  <label className="su-label">Workspace Slug</label>
                  <div style={{ position:'relative' }}>
                    <div style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'rgba(255,255,255,0.28)', fontWeight:600, pointerEvents:'none', whiteSpace:'nowrap' }}>taskee.app/</div>
                    <input className={`su-input su-input-sm${orgSlug&&!slugOk?' su-input-err':orgSlug&&slugOk?' su-input-ok':''}`}
                      style={{ paddingLeft:88 }} type="text" value={orgSlug}
                      onChange={e => { setOrgSlug(autoSlug(e.target.value)); setSlugEdited(true) }}
                      placeholder="acme-corp" required minLength={3} />
                  </div>
                  <div style={{ fontSize:11.5, color: orgSlug&&slugOk ? 'rgba(34,197,94,0.75)' : 'rgba(255,255,255,0.28)', marginTop:7, fontWeight:500 }}>
                    {orgSlug&&slugOk ? `✓ taskee.app/${orgSlug}` : 'Lowercase letters, numbers, and hyphens (3–50 chars)'}
                  </div>
                </div>
                <button type="submit" className="su-btn" disabled={!step1Ok} style={{ marginTop:4 }}>Continue →</button>
                <button type="button" className="su-btn-ghost" onClick={() => setStep(0)}>← Back</button>
              </>)}

              {step===2 && (<>
                <div style={{ display:'grid', gap:8 }}>
                  {PLANS.map(p => (
                    <button key={p.value} type="button" className={`su-plan${plan===p.value?' su-plan-sel':''}`} onClick={() => setPlan(p.value)}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                        <div>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                            <span style={{ fontWeight:800, fontSize:14.5, color:'#fff' }}>{p.label}</span>
                            {p.popular && <span style={{ fontSize:9.5, fontWeight:800, background:'rgba(226,171,65,0.18)', color:'#e2ab41', border:'1px solid rgba(226,171,65,0.35)', borderRadius:5, padding:'2px 7px', letterSpacing:'0.06em', textTransform:'uppercase' }}>Popular</span>}
                          </div>
                          <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.38)' }}>{p.desc}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0, marginLeft:12 }}>
                          <div style={{ fontWeight:900, fontSize:16, color:p.color }}>{p.price}</div>
                          {p.price!=='Free'&&p.price!=='Custom'&&<div style={{ fontSize:11, color:'rgba(255,255,255,0.28)', fontWeight:500 }}>per month</div>}
                        </div>
                      </div>
                      {plan===p.value && <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:14, height:14, borderRadius:'50%', border:`2px solid ${p.color}`, background:`${p.color}22`, display:'grid', placeItems:'center', flexShrink:0 }}>
                          <div style={{ width:5, height:5, borderRadius:'50%', background:p.color }} />
                        </div>
                        <span style={{ fontSize:12, color:p.color, fontWeight:700 }}>Selected</span>
                      </div>}
                    </button>
                  ))}
                </div>
                <button type="submit" className="su-btn" disabled={loading} style={{ marginTop:4 }}>
                  {loading
                    ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation:'su-spin 0.75s linear infinite' }}><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" opacity="0.9"/><circle cx="12" cy="12" r="10" opacity="0.15"/></svg>Creating workspace…</>
                    : `Create workspace — ${PLANS.find(p2=>p2.value===plan)?.price}`}
                </button>
                <button type="button" className="su-btn-ghost" onClick={() => setStep(1)}>← Back</button>
                <p style={{ textAlign:'center', fontSize:11.5, color:'rgba(255,255,255,0.22)', fontWeight:500 }}>
                  By creating an account you agree to our <a href="#" style={{ color:'rgba(255,255,255,0.38)', textDecoration:'underline' }}>Terms</a> and <a href="#" style={{ color:'rgba(255,255,255,0.38)', textDecoration:'underline' }}>Privacy Policy</a>
                </p>
              </>)}
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
