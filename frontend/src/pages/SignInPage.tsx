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

function LoadingSpinner() {
  return (
    <svg className="animate-rotate" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

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
    <div className="authShell">
      <div className="authCard animate-fadeInUp">
        <div className="authBrand">
          <div className="authLogo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <div className="authName">TaskFlow Pro</div>
            <div className="authTag">Streamline your workforce operations</div>
          </div>
        </div>

        <h1 className="authTitle">Welcome back</h1>
        <p className="authSubtitle">Sign in to access your dashboard and continue managing your team efficiently.</p>

        {error ? (
          <div className="alert alertError animate-fadeIn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="form">
          <label className="label">
            <span>Email address</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={loading}
            />
          </label>

          <label className="label">
            <span>Password</span>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </label>

          <button
            className="btn btnPrimary"
            disabled={!canSubmit || loading}
            type="submit"
            style={{ height: 52, fontSize: 15, marginTop: 8 }}
          >
            {loading ? (
              <>
                <LoadingSpinner />
                <span style={{ marginLeft: 10 }}>Signing in...</span>
              </>
            ) : (
              <>
                Sign in
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 8 }}>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="authFooter" style={{ marginTop: 24 }}>
          <Link to="/forgot-password">Forgot password?</Link>
          <span>·</span>
          <span>New to TaskFlow Pro?</span> <Link to="/signup" style={{ fontWeight: 700 }}>Create account</Link>
        </div>

        <div style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: 12
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Your data is encrypted and secure
        </div>
      </div>
    </div>
  )
}
