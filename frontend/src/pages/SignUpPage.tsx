import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

type SignupResponse = {
  message: string
  user: { id: string; email: string; fullName: string; emailVerified: boolean }
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = useMemo(() => {
    return (
      fullName.trim().length >= 2 &&
      email.trim().includes('@') &&
      password.length >= 8 &&
      organizationName.trim().length >= 2 &&
      /^[a-z0-9-]{3,50}$/.test(organizationSlug.trim())
    )
  }, [fullName, email, password, organizationName, organizationSlug])

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
  }

  const slugOk = useMemo(() => /^[a-z0-9-]{3,50}$/.test(organizationSlug.trim()), [organizationSlug])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const data = await apiFetch<SignupResponse>('/api/v1/auth/signup', {
        method: 'POST',
        json: {
          fullName,
          email,
          password,
          organizationName,
          organizationSlug,
          plan: 'basic',
          seats: 1,
        },
      })
      setSuccess(data.message || 'Account created. Please verify your email.')
      // In auth-prod we’ll implement an in-app verification UX; for now redirect to sign-in
      setTimeout(() => navigate('/signin', { replace: true }), 1200)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Sign up failed. Please try again.')
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
            <div className="authTag">Start with a secure workspace</div>
          </div>
        </div>

        <h1 className="authTitle">Create account</h1>
        <p className="authSubtitle">We’ll email you a verification link.</p>

        {error ? <div className="alert alertError">{error}</div> : null}
        {success ? <div className="alert alertSuccess">{success}</div> : null}

        <form onSubmit={onSubmit} className="form">
          <label className="label">
            Full name
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label className="label">
            Work email
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label className="label">
            Password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="label">
            Organization name
            <input
              className="input"
              value={organizationName}
              onChange={(e) => {
                const v = e.target.value
                setOrganizationName(v)
                if (!slugEdited) setOrganizationSlug(autoSlug(v))
              }}
            />
          </label>

          <label className="label">
            Organization slug
            <input
              className="input"
              value={organizationSlug}
              onFocus={() => setSlugEdited(true)}
              onChange={(e) => {
                setSlugEdited(true)
                setOrganizationSlug(autoSlug(e.target.value))
              }}
            />
            <span style={{ color: slugOk ? 'var(--muted)' : 'rgba(239, 68, 68, 0.9)', fontSize: 12 }}>
              {slugOk
                ? 'Lowercase letters/numbers/hyphens only (3–50).'
                : 'Slug must be 3–50 chars: lowercase letters, numbers, hyphens.'}
            </span>
          </label>

          <button className="btn btnPrimary" disabled={!canSubmit || loading} type="submit">
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div className="authFooter">
          <span>Already have an account?</span> <Link to="/signin">Sign in</Link>
        </div>
      </div>
    </div>
  )
}

