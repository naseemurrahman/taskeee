import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser } from '../state/auth'

async function login(email: string, password: string) {
  return await apiFetch<{
    accessToken: string; refreshToken: string
    user: { id: string; email: string; fullName: string; role: string; orgId: string }
  }>('/api/v1/auth/login', { method: 'POST', json: { email, password } })
}

export function SignInPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setError(null); setLoading(true)
    try {
      const data = await login(email.trim().toLowerCase(), password)
      setAccessToken(data.accessToken); setRefreshToken(data.refreshToken); setUser(data.user)
      const next = params.get('next')
      navigate(next && next.startsWith('/app') ? next : '/app/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#0a0a10' }}>
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .authInput{width:100%;padding:13px 44px 13px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:15px;outline:none;transition:all 0.15s;box-sizing:border-box}
        .authInput:focus{border-color:#e2ab41;box-shadow:0 0 0 3px rgba(226,171,65,0.15)}
        .authInput::placeholder{color:rgba(255,255,255,0.35)}
        .authSubmit{width:100%;padding:14px;border-radius:12px;border:none;background:#e2ab41;color:#000;font-size:16px;font-weight:900;cursor:pointer;transition:all 0.15s}
        .authSubmit:hover:not(:disabled){background:#f0bc52;transform:translateY(-1px);box-shadow:0 8px 24px rgba(226,171,65,0.35)}
        .authSubmit:disabled{opacity:0.6;cursor:not-allowed}
        @media(max-width:768px){.authGrid{grid-template-columns:1fr!important}.authLeft{display:none!important}.authRight{padding:32px 20px!important}}
      `}</style>

      {/* Left — branding panel */}
      <div className="authLeft" style={{ padding: '48px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'linear-gradient(160deg, #0f1018 0%, #13111f 50%, #0f1018 100%)', borderRight: '1px solid rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
        {/* Glow */}
        <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(226,171,65,0.12) 0%, transparent 70%)', top: -100, right: -100, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)', bottom: 0, left: -80, pointerEvents: 'none' }} />

        {/* Brand */}
        <div>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
            <div style={{ width: 40, height: 40, borderRadius: 13, background: 'linear-gradient(135deg, #e2ab41, #f59e0b)', display: 'grid', placeItems: 'center', boxShadow: '0 4px 16px rgba(226,171,65,0.35)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span style={{ fontWeight: 950, fontSize: 20, color: '#fff', letterSpacing: '-0.5px' }}>TaskFlow Pro</span>
          </Link>
        </div>

        {/* Center content */}
        <div style={{ animation: 'fadeIn 0.6s ease' }}>
          <h1 style={{ fontSize: 'clamp(28px,3vw,44px)', fontWeight: 950, letterSpacing: '-1.5px', color: '#fff', lineHeight: 1.1, margin: '0 0 16px' }}>
            Every team.<br />Every deadline.<br /><span style={{ color: '#e2ab41' }}>Delivered.</span>
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, maxWidth: 360, margin: '0 0 40px' }}>
            AI-powered task management with role-based access, real-time analytics, and smart approvals — built for organizations that demand accountability.
          </p>
          {/* Feature pills */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { color: '#e2ab41', icon: '🤖', text: 'AI-assisted task approvals & analysis' },
              { color: '#22c55e', icon: '📊', text: 'Real-time dashboards with live charts' },
              { color: '#8B5CF6', icon: '🔐', text: 'Role-based access for every team member' },
              { color: '#38bdf8', icon: '💬', text: 'Task comments & WhatsApp notifications' },
            ].map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: f.color + '18', border: `1px solid ${f.color}30`, display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>{f.icon}</div>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 32 }}>
          {[['500+', 'Organizations'], ['98%', 'Uptime'], ['10K+', 'Daily tasks']].map(([v, l]) => (
            <div key={l}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#e2ab41', letterSpacing: '-0.5px' }}>{v}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, fontWeight: 600 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div className="authRight" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 60px' }}>
        <div style={{ width: '100%', maxWidth: 400, animation: 'fadeIn 0.4s ease' }}>
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.8px', margin: '0 0 8px' }}>Welcome back</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Sign in to your organization's workspace</p>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 20, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 14, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Work Email</label>
              <input className="authInput" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
                <Link to="/forgot-password" style={{ fontSize: 12, color: '#e2ab41', textDecoration: 'none', fontWeight: 600 }}>Forgot password?</Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input className="authInput" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center' }}>
                  {showPw ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            <button type="submit" className="authSubmit" disabled={loading}>
              {loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 0.8s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in →'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Don't have an account? </span>
            <Link to="/signup" style={{ fontSize: 14, color: '#e2ab41', fontWeight: 700, textDecoration: 'none' }}>Create one free</Link>
          </div>

          {/* Trust signals */}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 36, paddingTop: 28, borderTop: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' }}>
            {['🔒 SOC 2 Ready', '🌐 99.9% Uptime', '📱 Mobile Friendly'].map(t => (
              <span key={t} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
