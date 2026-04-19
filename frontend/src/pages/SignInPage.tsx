import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setUser } from '../state/auth'

type LoginResponse = {
  accessToken: string
  refreshToken?: string
  user: { id: string; email: string; fullName: string; role: string; orgId: string }
  mfaRequired?: boolean
  mfaToken?: string
}

function setLegacyAuth(accessToken: string, user: LoginResponse['user']) {
  localStorage.setItem('auth_token', accessToken)
  localStorage.setItem('user_data', JSON.stringify(user))
}

const SHOWCASE_FEATS = [
  {
    color: '#f4ca57',
    bg: 'rgba(244,202,87,0.12)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    title: 'AI-assisted approvals',
    text: 'Employees submit work, AI reviews it — with full audit trail and manager override.',
  },
  {
    color: '#6d5efc',
    bg: 'rgba(109,94,252,0.12)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'Role-based access control',
    text: 'Admin, HR, Manager, Supervisor, Employee — every level scoped precisely.',
  },
  {
    color: '#10b981',
    bg: 'rgba(16,185,129,0.12)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
    title: 'Real-time analytics',
    text: 'Live dashboards with workload balance, completion trends, and performance scores.',
  },
]

export function SignInPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = params.get('next') || '/app/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const canSubmit = useMemo(() => email.trim().length > 3 && password.length > 0, [email, password])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        json: { email, password },
      })
      if (data.mfaRequired) {
        navigate(`/mfa?token=${encodeURIComponent(data.mfaToken || '')}&next=${encodeURIComponent(next)}`, { replace: true })
        return
      }
      if (data.accessToken) {
        setAccessToken(data.accessToken)
        if (data.user) setUser(data.user)
        setLegacyAuth(data.accessToken, data.user)
        navigate(next, { replace: true })
        return
      }
      setError('Sign in failed. Please try again.')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Sign in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="authShellV2">
      {/* Left decorative panel */}
      <div className="authShellV2Left">
        <div className="authV2Showcase animate-fadeInUp">
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div className="authV2LogoMark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 950, fontSize: 16, letterSpacing: '-0.3px' }}>TaskFlow Pro</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>HR + Workflows + AI</div>
              </div>
            </div>
          </div>

          <h2 className="authV2ShowcaseTitle">
            The org platform<br />
            <span style={{ background: 'linear-gradient(135deg, #f4ca57, #6d5efc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              built for teams
            </span>
          </h2>
          <p className="authV2ShowcaseText">
            Structured workflows for onboarding, approvals, tasks, and performance. Everything in one place.
          </p>

          <div className="authV2ShowcaseFeats">
            {SHOWCASE_FEATS.map((f) => (
              <div className="authV2ShowcaseFeat" key={f.title}>
                <div className="authV2ShowcaseFeatIcon" style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <div>
                  <div className="authV2ShowcaseFeatTitle">{f.title}</div>
                  <div className="authV2ShowcaseFeatText">{f.text}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Mini stat strip */}
          <div style={{ marginTop: 36, display: 'flex', gap: 0, padding: '14px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            {[
              { val: '5K+', lab: 'Employees' },
              { val: '12K+', lab: 'Tasks done' },
              { val: '98%', lab: 'Accuracy' },
            ].map((s, i) => (
              <div key={s.lab} style={{ flex: 1, textAlign: 'center', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: '-0.4px', color: '#f4ca57' }}>{s.val}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{s.lab}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="authShellV2Right">
        <div className="authV2Card animate-fadeInUp">
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
              <div className="authV2Tagline">Streamline your workforce operations</div>
            </div>
          </div>

          <h1 className="authV2H1">Welcome back</h1>
          <p className="authV2Sub">Sign in to access your dashboard and team.</p>

          {error && (
            <div className="authV2Error animate-fadeIn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div className="authV2Field">
              <label className="authV2Label" htmlFor="email">Email address</label>
              <input
                id="email"
                className="authV2Input"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="authV2ShowPwd"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="authV2Submit"
              disabled={!canSubmit || loading}
            >
              {loading ? (
                <>
                  <svg className="animate-rotate" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.416" strokeDashoffset="10" opacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="authV2Divider">or</div>

          <div className="authV2Links">
            <Link to="/forgot-password">Forgot password?</Link>
            <span>No account? <Link to="/signup">Sign up free</Link></span>
          </div>
        </div>
      </div>
    </div>
  )
}
