import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { setAccessToken, setRefreshToken, setUser } from '../state/auth'

const PLANS = [
  { value: 'basic', label: 'Starter', desc: 'Core task management', price: 'Free' },
  { value: 'pro', label: 'Professional', desc: 'AI automations and analytics', price: '$12/seat' },
  { value: 'enterprise', label: 'Enterprise', desc: 'Custom integrations and governance', price: 'Custom' },
]

type LoginResponse = {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string; fullName: string; role: string; orgId: string }
}

async function createWorkspace(data: {
  fullName: string
  email: string
  password: string
  organizationName: string
  organizationSlug: string
  plan: string
  seats: number
}) {
  return apiFetch<{
    accessToken: string; refreshToken: string
    user: { id: string; email: string; fullName: string; role: string; orgId: string }
  }>('/api/v1/auth/signup', { method: 'POST', json: data, timeoutMs: 30_000 })
}

async function login(email: string, password: string) {
  return apiFetch<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    json: { email, password },
    timeoutMs: 30_000,
  })
}

function autoSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [plan, setPlan] = useState('basic')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const passwordChecks = useMemo(() => [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', ok: /[a-z]/.test(password) },
    { label: 'Number', ok: /\d/.test(password) },
    { label: 'Special character', ok: /[^a-zA-Z0-9]/.test(password) },
  ], [password])

  const slugOk = /^[a-z0-9-]{3,50}$/.test(organizationSlug.trim())
  const passwordOk = passwordChecks.every((check) => check.ok)
  const step0Ok = fullName.trim().length >= 2 && email.includes('@') && passwordOk && password === confirmPw
  const step1Ok = organizationName.trim().length >= 2 && slugOk

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (step === 0) {
      if (!step0Ok) {
        setError('Complete all account fields and match the password policy.')
        return
      }
      setStep(1)
      return
    }

    if (step === 1) {
      if (!step1Ok) {
        setError('Enter a valid organization name and workspace slug.')
        return
      }
      setStep(2)
      return
    }

    setLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const result = await createWorkspace({
        fullName: fullName.trim(),
        email: normalizedEmail,
        password,
        organizationName: organizationName.trim(),
        organizationSlug: organizationSlug.trim().toLowerCase(),
        plan,
        seats: 1,
      })

      setAccessToken(result.accessToken)
      setRefreshToken(result.refreshToken)
      setUser(result.user)
      navigate('/app/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your workspace. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#fff', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 460, background: '#0b0f1b', border: '1px solid rgba(255,255,255,.08)', borderRadius: 20, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <Link to="/" style={{ color: '#e2ab41', textDecoration: 'none', fontWeight: 800, letterSpacing: '.12em', fontSize: 13 }}>TASKEE</Link>
        <div style={{ marginTop: 28, marginBottom: 24 }}>
          <div style={{ color: '#e2ab41', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, letterSpacing: '.12em' }}>Step {step + 1} of 3</div>
          <h1 style={{ margin: '8px 0 6px', fontSize: 28, lineHeight: 1.1 }}>{step === 0 ? 'Create your account' : step === 1 ? 'Name your workspace' : 'Choose your plan'}</h1>
          <p style={{ margin: 0, color: 'rgba(255,255,255,.55)', fontSize: 14 }}>
            {step === 0 ? <>Already have an account? <Link to="/signin" style={{ color: '#e2ab41' }}>Sign in</Link></> : step === 1 ? 'Your workspace URL uses this slug.' : 'Your admin user will be created after this step.'}
          </p>
        </div>

        {error && <div style={{ marginBottom: 16, padding: 12, borderRadius: 12, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#fca5a5', fontSize: 14 }}>{error}</div>}

        <div style={{ display: 'grid', gap: 14 }}>
          {step === 0 && <>
            <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Admin User" autoComplete="name" />
            <Field label="Work email" value={email} onChange={setEmail} placeholder="you@company.com" type="email" autoComplete="email" />
            <Field label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" autoComplete="new-password" />
            {password && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: 'rgba(255,255,255,.65)', fontSize: 12 }}>{passwordChecks.map((check) => <span key={check.label} style={{ color: check.ok ? '#4ade80' : 'rgba(255,255,255,.35)' }}>{check.ok ? '✓' : '○'} {check.label}</span>)}</div>}
            <Field label="Re-enter password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat password" type="password" autoComplete="new-password" error={confirmPw.length > 0 && confirmPw !== password ? "Passwords do not match" : undefined} />
          </>}

          {step === 1 && <>
            <Field label="Organization name" value={organizationName} onChange={(value) => { setOrganizationName(value); if (!slugEdited) setOrganizationSlug(autoSlug(value)) }} placeholder="Almalath" />
            <Field label="Workspace slug" value={organizationSlug} onChange={(value) => { setOrganizationSlug(autoSlug(value)); setSlugEdited(true) }} placeholder="almalath" prefix="taskee.app/" />
            <div style={{ color: slugOk ? '#4ade80' : 'rgba(255,255,255,.45)', fontSize: 13 }}>{slugOk ? `✓ taskee.app/${organizationSlug}` : 'Use 3–50 lowercase letters, numbers, or hyphens.'}</div>
          </>}

          {step === 2 && <div style={{ display: 'grid', gap: 10 }}>{PLANS.map((item) => <button key={item.value} type="button" onClick={() => setPlan(item.value)} style={{ textAlign: 'left', padding: 16, borderRadius: 14, border: plan === item.value ? '1px solid rgba(226,171,65,.7)' : '1px solid rgba(255,255,255,.1)', background: plan === item.value ? 'rgba(226,171,65,.10)' : 'rgba(255,255,255,.04)', color: '#fff', cursor: 'pointer' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><strong>{item.label}</strong><strong style={{ color: '#e2ab41' }}>{item.price}</strong></div><div style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, marginTop: 4 }}>{item.desc}</div></button>)}</div>}

          <button type="submit" disabled={loading || (step === 0 && !step0Ok) || (step === 1 && !step1Ok)} style={{ height: 52, borderRadius: 14, border: 0, background: '#e2ab41', color: '#090909', fontWeight: 900, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}>{loading ? 'Creating workspace…' : step === 2 ? 'Create admin user' : 'Continue →'}</button>
          {step > 0 && <button type="button" onClick={() => setStep((step - 1) as 0 | 1)} style={{ height: 46, borderRadius: 14, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'rgba(255,255,255,.65)', fontWeight: 800 }}>← Back</button>}
        </div>
      </form>
    </div>
  )
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; autoComplete?: string; prefix?: string; error?: string }) {
  const [show, setShow] = useState(false)
  const isPassword = props.type === 'password'
  const inputType = isPassword ? (show ? 'text' : 'password') : (props.type || 'text')
  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, letterSpacing: '.08em' }}>{props.label}</span>
      <div style={{ position: 'relative' }}>
        {props.prefix && <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.35)', fontSize: 14 }}>{props.prefix}</span>}
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} type={inputType} autoComplete={props.autoComplete}
          style={{ width: '100%', height: 50, borderRadius: 12, border: props.error ? '1px solid rgba(239,68,68,.6)' : '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: '#fff', outline: 'none', padding: props.prefix ? '0 42px 0 94px' : isPassword ? '0 44px 0 14px' : '0 14px', fontSize: 15 }} />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.45)', padding: 0, display: 'flex', alignItems: 'center' }}>
            {show
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        )}
      </div>
      {props.error && <span style={{ color: 'rgba(239,68,68,.9)', fontSize: 12, fontWeight: 500 }}>{props.error}</span>}
    </label>
  )
}
