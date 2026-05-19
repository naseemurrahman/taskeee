import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser, type AuthUser } from '../state/auth'
import { getMktTheme } from '../lib/mktTheme'

async function login(email: string, password: string) {
  return await apiFetch<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    '/api/v1/auth/login', { method: 'POST', json: { email, password } }
  )
}
type ServerProfileUser = { id?: string; email?: string; full_name?: string; fullName?: string; role?: string; org_id?: string; orgId?: string }
function toAuthUser(user: ServerProfileUser, fallback?: Partial<AuthUser>): AuthUser {
  return {
    id: String(user.id || fallback?.id || ''),
    email: String(user.email || fallback?.email || ''),
    fullName: String(user.fullName || user.full_name || fallback?.fullName || ''),
    role: String(user.role || fallback?.role || 'employee'),
    orgId: String(user.orgId || user.org_id || fallback?.orgId || ''),
  }
}
async function loadCurrentUser(loginUser: AuthUser): Promise<AuthUser> {
  try {
    const profile = await apiFetch<{ user: ServerProfileUser }>('/api/v1/users/profile')
    return toAuthUser(profile.user || {}, loginUser)
  } catch { return toAuthUser(loginUser, loginUser) }
}

export function SignInPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const sessionExpired = params.get('reason') === 'session_expired'
  const theme = getMktTheme()
  const isDark = theme === 'dark'

  const bg = isDark ? '#060810' : '#f8f8f6'
  const leftBg = isDark ? 'linear-gradient(150deg,#08091a 0%,#0c0f24 60%,#09111e 100%)' : 'linear-gradient(150deg,#fffdf7 0%,#fef9ed 60%,#fef5e0 100%)'
  const leftBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'
  const textColor = isDark ? '#ffffff' : '#0f0f0e'
  const mutedColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'
  const subColor = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)'
  const inputBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
  const inputBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)'
  const inputFocusBorder = 'rgba(226,171,65,0.6)'
  const featureBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
  const trustColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)'
  const dividerColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
  const eyeColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'
  const labelColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)'
  const statBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const statNumColor = '#e2ab41'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setError(null); setLoading(true)
    try {
      const data = await login(email.trim().toLowerCase(), password)
      setAccessToken(data.accessToken); setRefreshToken(data.refreshToken)
      setUser(toAuthUser(data.user, data.user))
      const currentUser = await loadCurrentUser(data.user)
      setUser(currentUser)
      const next = params.get('next')
      navigate(next && next.startsWith('/app') ? next : '/app/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .si-root{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
        .si-panel{position:relative;display:flex;flex-direction:column;justify-content:center;padding:48px 64px;overflow:hidden}
        .si-orb{position:absolute;border-radius:50%;pointer-events:none;filter:blur(90px)}
        .si-feature{display:flex;align-items:flex-start;gap:14px;padding:13px 0;border-bottom:1px solid var(--si-feat-border)}
        .si-feature:last-child{border-bottom:none}
        .si-feature-icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex-shrink:0}
        .si-stat{text-align:center;padding:0 18px}
        .si-stat+.si-stat{border-left:1px solid var(--si-stat-border)}
        .si-input{width:100%;height:50px;padding:0 44px 0 16px;background:var(--si-input-bg);border:1px solid var(--si-input-border);border-radius:11px;color:var(--si-text);font-size:15px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:500;outline:none;transition:border-color 0.15s,box-shadow 0.15s,background 0.15s}
        .si-input:focus{border-color:rgba(226,171,65,0.6);box-shadow:0 0 0 3px rgba(226,171,65,0.1)}
        .si-input::placeholder{color:var(--si-muted)}
        .si-btn{width:100%;height:52px;border:none;border-radius:11px;background:linear-gradient(135deg,#c98317 0%,#e2ab41 50%,#f4ca57 100%);color:#0a0800;font-size:15px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:800;cursor:pointer;letter-spacing:-0.01em;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:8px}
        .si-btn:hover:not(:disabled){box-shadow:0 8px 32px rgba(226,171,65,0.38);transform:translateY(-1px)}
        .si-btn:disabled{opacity:0.55;cursor:not-allowed;transform:none}
        .si-err{padding:13px 16px;border-radius:10px;background:rgba(239,68,68,0.09);border:1px solid rgba(239,68,68,0.25);color:#f87171;font-size:13.5px;font-weight:600;display:flex;gap:10px;align-items:flex-start;margin-bottom:18px}
        .si-warn{padding:13px 16px;border-radius:10px;background:rgba(245,158,11,0.09);border:1px solid rgba(245,158,11,0.25);color:#fbbf24;font-size:13.5px;font-weight:600;display:flex;gap:10px;align-items:flex-start;margin-bottom:18px}
        @keyframes si-fade{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes si-spin{to{transform:rotate(360deg)}}
        .si-animate{animation:si-fade 0.5s ease forwards}
        .si-animate-slow{animation:si-fade 0.7s 0.1s ease both}
        @media(max-width:860px){.si-root{grid-template-columns:1fr}.si-left{display:none}.si-panel{padding:36px 28px}}
        @media(max-width:400px){.si-panel{padding:28px 20px}}
      `}</style>
      <style>{`
        :root {
          --si-text: ${textColor};
          --si-muted: ${mutedColor};
          --si-input-bg: ${inputBg};
          --si-input-border: ${inputBorder};
          --si-feat-border: ${featureBorder};
          --si-stat-border: ${statBorder};
        }
      `}</style>

      <div className="si-root" style={{ background: bg }}>

        {/* ── Left: Brand panel ── */}
        <div className="si-panel si-left" style={{ background: leftBg, borderRight: `1px solid ${leftBorder}` }}>
          <div className="si-orb" style={{ width:600, height:600, background: isDark?'rgba(226,171,65,0.09)':'rgba(226,171,65,0.12)', top:-200, right:-150 }} />
          <div className="si-orb" style={{ width:400, height:400, background: isDark?'rgba(99,102,241,0.08)':'rgba(99,102,241,0.05)', bottom:-100, left:-80 }} />

          <div style={{ position:'relative', zIndex:1, maxWidth:480 }}>
            <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:12, textDecoration:'none', marginBottom:52 }}>
              <div style={{ width:40, height:40, borderRadius:11, background: isDark?'linear-gradient(135deg,#1c1710,#0d0b08)':'linear-gradient(135deg,#fff8ec,#fef3dc)', border:'1.5px solid rgba(226,171,65,0.4)', display:'grid', placeItems:'center', boxShadow:'0 4px 18px rgba(226,171,65,0.18)' }}>
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="slg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs><rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#slg1)"/><rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#slg1)"/></svg>
              </div>
              <span style={{ fontWeight:900, fontSize:15, letterSpacing:'0.14em', textTransform:'uppercase', background:'linear-gradient(135deg,#f9e6a2,#e2ab41)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>TASKEE</span>
            </Link>

            <div className="si-animate">
              <h1 style={{ fontSize:'clamp(28px,3.5vw,44px)', fontWeight:950, letterSpacing:'-1.5px', color:textColor, lineHeight:1.08, marginBottom:14 }}>
                Where teams get<br /><span style={{ color:'#e2ab41' }}>work done.</span>
              </h1>
              <p style={{ fontSize:15, color:mutedColor, lineHeight:1.75, marginBottom:38, maxWidth:360 }}>
                AI-powered task intelligence for organizations that track accountability — not just progress.
              </p>
            </div>

            <div className="si-animate-slow">
              {[
                { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>, color:'#e2ab41', bg:`rgba(226,171,65,${isDark?'0.1':'0.12'})`, border:`rgba(226,171,65,${isDark?'0.2':'0.3'})`, title:'AI Task Analysis', body:'Auto-reviews submissions and flags risks before managers review.' },
                { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>, color:'#6366f1', bg:`rgba(99,102,241,${isDark?'0.1':'0.08'})`, border:`rgba(99,102,241,${isDark?'0.2':'0.2'})`, title:'Live Performance Charts', body:'Real-time dashboards — no refresh needed, ever.' },
                { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, color:'#22c55e', bg:`rgba(34,197,94,${isDark?'0.1':'0.1'})`, border:`rgba(34,197,94,${isDark?'0.2':'0.2'})`, title:'Role-Based Access', body:'Admin, HR, Manager, Employee — every action scoped correctly.' },
                { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, color:'#38bdf8', bg:`rgba(56,189,248,${isDark?'0.1':'0.1'})`, border:`rgba(56,189,248,${isDark?'0.2':'0.2'})`, title:'Task Chat + WhatsApp', body:'Comment threads per task. WhatsApp delivery for field teams.' },
              ].map(f => (
                <div key={f.title} className="si-feature">
                  <div className="si-feature-icon" style={{ background:f.bg, border:`1px solid ${f.border}`, color:f.color }}>{f.icon}</div>
                  <div>
                    <div style={{ fontWeight:800, fontSize:13.5, color:textColor, marginBottom:3 }}>{f.title}</div>
                    <div style={{ fontSize:12.5, color:subColor, lineHeight:1.5 }}>{f.body}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display:'flex', marginTop:36, paddingTop:28, borderTop:`1px solid ${featureBorder}` }}>
              {[['500+','Organizations'],['10K+','Daily tasks'],['98%','Uptime']].map(([v, l]) => (
                <div key={l} className="si-stat" style={{ flex:1 }}>
                  <div style={{ fontSize:20, fontWeight:950, color:statNumColor, letterSpacing:'-0.5px' }}>{v}</div>
                  <div style={{ fontSize:10.5, color:subColor, marginTop:3, fontWeight:600 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Form panel ── */}
        <div className="si-panel" style={{ alignItems:'center', background: isDark?'#060810':'#ffffff' }}>
          <div style={{ width:'100%', maxWidth:400 }} className="si-animate">
            <div style={{ marginBottom:32 }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(226,171,65,0.75)', marginBottom:10 }}>— Welcome back</div>
              <h2 style={{ fontSize:28, fontWeight:950, color:textColor, letterSpacing:'-0.8px', marginBottom:8 }}>Sign in to your workspace</h2>
              <p style={{ fontSize:14, color:mutedColor, fontWeight:500 }}>
                Don't have an account?{' '}
                <Link to="/signup" style={{ color:'#e2ab41', textDecoration:'none', fontWeight:700 }}>Create one free →</Link>
              </p>
            </div>

            {sessionExpired && (
              <div className="si-warn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Your session expired. Please sign in again.
              </div>
            )}
            {error && (
              <div className="si-err">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            <form onSubmit={onSubmit}>
              <div style={{ marginBottom:16 }}>
                <label style={{ display:'block', fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:labelColor, marginBottom:8 }}>Work Email</label>
                <input className="si-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
              </div>
              <div style={{ marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <label style={{ fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:labelColor }}>Password</label>
                  <Link to="/forgot-password" style={{ fontSize:12, color:'rgba(226,171,65,0.8)', textDecoration:'none', fontWeight:700 }}>Forgot password?</Link>
                </div>
                <div style={{ position:'relative' }}>
                  <input className="si-input" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:eyeColor, display:'grid', placeItems:'center', padding:4 }}>
                    {showPw
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
              </div>
              <div style={{ marginTop:8 }}>
                <button type="submit" className="si-btn" disabled={loading}>
                  {loading ? (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation:'si-spin 0.75s linear infinite', flexShrink:0 }}><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" opacity="0.9"/><circle cx="12" cy="12" r="10" opacity="0.15"/></svg>Signing you in…</>) : 'Sign in to workspace →'}
                </button>
              </div>
            </form>

            <div style={{ borderTop:`1px solid ${dividerColor}`, margin:'24px 0' }} />

            <div style={{ display:'flex', gap:20, justifyContent:'center', flexWrap:'wrap' }}>
              {[['🔒','SOC 2 Ready'],['⏱','99.9% Uptime'],['🛡','Encrypted']].map(([icon, label]) => (
                <span key={label as string} style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11.5, color:trustColor, fontWeight:600 }}>{icon as string} {label as string}</span>
              ))}
            </div>

            <div style={{ marginTop:20, textAlign:'center' }}>
              <Link to="/" style={{ fontSize:12, color:mutedColor, textDecoration:'none', fontWeight:600, display:'inline-flex', alignItems:'center', gap:4 }}>
                ← Back to homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
