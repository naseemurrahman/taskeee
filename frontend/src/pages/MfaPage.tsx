import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setUser } from '../state/auth'

type MfaVerifyResponse = {
  accessToken: string
  refreshToken?: string
  user: { id: string; email: string; fullName: string; role: string; orgId: string }
}

function setLegacyAuth(accessToken: string, user: MfaVerifyResponse['user']) {
  localStorage.setItem('auth_token', accessToken)
  localStorage.setItem('user_data', JSON.stringify(user))
}

export function MfaPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const mfaToken = params.get('token') || ''
  const next = params.get('next') || '/app/dashboard'

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = useMemo(() => mfaToken.length > 10 && code.trim().length >= 6, [mfaToken, code])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await apiFetch<MfaVerifyResponse>('/api/v1/auth/mfa/verify', {
        method: 'POST',
        json: { mfaToken, code },
      })
      setAccessToken(data.accessToken)
      if (data.user) setUser(data.user)
      setLegacyAuth(data.accessToken, data.user)
      navigate(next, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="authShell">
      <div className="authCard">
        <div className="authBrand">
          <div className="authLogo">TF</div>
          <div>
            <div className="authName">TaskFlow Pro</div>
            <div className="authTag">Multi-factor authentication</div>
          </div>
        </div>

        <h1 className="authTitle">Verify it’s you</h1>
        <p className="authSubtitle">Enter the 6-digit code from your authenticator app.</p>

        {!mfaToken ? <div className="alert alertError">Missing MFA challenge. Please sign in again.</div> : null}
        {error ? <div className="alert alertError">{error}</div> : null}

        <form onSubmit={onSubmit} className="form">
          <label className="label">
            Authentication code
            <input className="input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>

          <button className="btn btnPrimary" disabled={!canSubmit || loading} type="submit">
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <div className="authFooter">
          <Link to="/signin">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

