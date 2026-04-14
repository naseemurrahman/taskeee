import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSubmit = useMemo(() => email.trim().includes('@'), [email])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const data = await apiFetch<{ message: string }>('/api/v1/auth/forgot-password', {
        method: 'POST',
        json: { email },
      })
      setSuccess(data.message || 'If an account exists, a reset link has been sent.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="authShell">
      <div className="authCard">
        <h1 className="authTitle">Reset your password</h1>
        <p className="authSubtitle">We’ll email you a reset link.</p>

        {error ? <div className="alert alertError">{error}</div> : null}
        {success ? <div className="alert alertSuccess">{success}</div> : null}

        <form onSubmit={onSubmit} className="form">
          <label className="label">
            Email
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btnPrimary" disabled={!canSubmit || loading} type="submit">
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <div className="authFooter">
          <Link to="/signin">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

