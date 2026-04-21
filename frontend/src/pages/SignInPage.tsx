import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser } from '../state/auth'
import { Input } from '../components/ui/Input'

async function login(email: string, password: string) {
  return await apiFetch<{
    accessToken: string; refreshToken: string
    user: { id: string; email: string; fullName: string; role: string; orgId: string }
  }>('/api/v1/auth/login', { method: 'POST', json: { email, password } })
}

const FEATURES = [
  { icon: '🤖', title: 'AI-Assisted Approvals', desc: 'Smart workflow decisions with full audit trail' },
  { icon: '🎯', title: 'Role-Based Access', desc: 'Admin, HR, Manager, Employee — scoped precisely' },
  { icon: '📊', title: 'Live Analytics', desc: 'Real-time dashboards, charts, and performance data' },
  { icon: '👥', title: 'HR Management', desc: 'Employees, time off, payroll — all in one place' },
]

export function SignInPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
            The platform<br/>
            <span className="authV4Accent">built for teams</span>
          </h2>
          <p className="authV4LeftSub">
            Structured workflows for HR, approvals, tasks, and performance — everything in one place.
          </p>

          <div className="authV4Features">
            {FEATURES.map(f => (
              <div key={f.title} className="authV4FeatureRow">
                <div className="authV4FeatureIcon">{f.icon}</div>
                <div>
                  <div className="authV4FeatureTitle">{f.title}</div>
                  <div className="authV4FeatureDesc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="authV4Stats">
            {[['5K+', 'Employees'], ['12K+', 'Tasks Done'], ['98%', 'Accuracy']].map(([v, l]) => (
              <div key={l} className="authV4Stat">
                <div className="authV4StatVal">{v}</div>
                <div className="authV4StatLabel">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="authV4Right">
        <div className="authV4Card">
          <div className="authV4CardLogo">
            <div className="authV4LogoMark">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span style={{ fontWeight: 950, fontSize: 15 }}>TaskFlow Pro</span>
          </div>

          <h1 className="authV4Title">Welcome back</h1>
          <p className="authV4Sub">Sign in to access your dashboard and team.</p>

          {error && (
            <div className="alertV4 alertV4Error" style={{ marginBottom: 16 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
            <Input
              label="Email Address" type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email" autoFocus
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
            />
            <Input
              label="Password" type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••" autoComplete="current-password"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
            />

            <div style={{ textAlign: 'right', marginTop: -6 }}>
              <Link to="/forgot-password" className="authV4ForgotLink">Forgot password?</Link>
            </div>

            <button
              type="submit"
              className="authV4SubmitBtn"
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <svg className="animate-rotate" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in →'}
            </button>
          </form>

          <div className="authV4Footer">
            Don't have an account? <Link to="/signup" className="authV4FooterLink">Sign up free</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
