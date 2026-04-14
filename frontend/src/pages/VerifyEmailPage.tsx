import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState<string>('Verifying your email…')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!token) {
        setStatus('error')
        setMessage('Missing token.')
        return
      }
      try {
        const data = await apiFetch<{ message: string }>('/api/v1/auth/verify-email', {
          method: 'POST',
          json: { token },
        })
        if (cancelled) return
        setStatus('success')
        setMessage(data.message || 'Email verified.')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setMessage(err instanceof ApiError ? err.message : 'Verification failed.')
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="authShell">
      <div className="authCard">
        <h1 className="authTitle">Email verification</h1>
        <p className="authSubtitle">{message}</p>

        {status === 'success' ? (
          <div className="alert alertSuccess">You can now sign in.</div>
        ) : status === 'error' ? (
          <div className="alert alertError">Please request a new verification email.</div>
        ) : null}

        <div className="authFooter">
          <Link to="/signin">Go to sign in</Link>
        </div>
      </div>
    </div>
  )
}

