import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSubmit = useMemo(() => token.length > 10 && password.length >= 8, [token, password])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const data = await apiFetch<{ message: string }>('/api/v1/auth/reset-password', {
        method: 'POST',
        json: { token, password },
      })
      setSuccess(data.message || 'Password updated.')
      setTimeout(() => navigate('/signin', { replace: true }), 1200)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="authShell">
      <div className="authCard">
        <h1 className="authTitle">Set a new password</h1>
        <p className="authSubtitle">Choose a strong password (8+ characters).</p>

        {!token ? <div className="alert alertError">Missing token.</div> : null}
        {error ? <div className="alert alertError">{error}</div> : null}
        {success ? <div className="alert alertSuccess">{success}</div> : null}

        <form onSubmit={onSubmit} className="form">
          <label className="label">
            New password
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btnPrimary" disabled={!canSubmit || loading} type="submit">
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <div className="authFooter">
          <Link to="/signin">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

