import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { EmployeeDetailModal } from '../../components/employees/EmployeeDetailModal'

type UserRow = {
  id: string
  email: string
  full_name?: string | null
  role: string
  department?: string | null
  manager_id?: string | null
  manager_name?: string | null
  created_at?: string
  last_login_at?: string | null
}

async function fetchUsers(search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '80' })
  if (search.trim()) qs.set('search', search.trim())
  const data = await apiFetch<{ users: UserRow[] }>(`/api/v1/users?${qs.toString()}`)
  return data.users || []
}

async function createUser(input: { email: string; password: string; fullName: string; role: string; department?: string }) {
  return await apiFetch(`/api/v1/users`, { method: 'POST', json: input })
}

export function TeamPage() {
  const me = getUser()
  const qc = useQueryClient()
  const [pickId, setPickId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const q = useQuery({ queryKey: ['team', 'users', search], queryFn: () => fetchUsers(search) })
  const users = useMemo(() => q.data || [], [q.data])

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('employee')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setEmail('')
      setFullName('')
      setPassword('')
      setDepartment('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['team', 'users'] })
      // Show success message
      const successMsg = document.createElement('div')
      successMsg.className = 'alert alertSuccess'
      successMsg.textContent = 'User created successfully! Employee record created automatically.'
      successMsg.style.marginBottom = '12px'
      document.querySelector('.card')?.insertBefore(successMsg, document.querySelector('.card')?.firstChild)
      setTimeout(() => successMsg.remove(), 5000)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // Show more helpful error messages
        if (err.message.includes('already exists')) {
          setError(err.message + ' You can find them in the Directory or Employees page.')
        } else {
          setError(err.message)
        }
      } else {
        setError('Failed to add team member.')
      }
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const e1 = email.trim().toLowerCase()
    if (!e1.includes('@')) return setError('Enter a valid email.')
    if (fullName.trim().length < 2) return setError('Full name must be at least 2 characters.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    m.mutate({ email: e1, password, fullName: fullName.trim(), role, department: department.trim() || undefined })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Team</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Directory and member management (role-scoped).</div>
          </div>
          <label className="label" style={{ margin: 0 }}>
            Search
            <input className="input" style={{ height: 40 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email…" />
          </label>
        </div>
      </div>

      {me?.role && ['director', 'admin', 'manager'].includes(me.role) ? (
        <div className="card">
          <h3 style={{ margin: 0, marginBottom: 12 }}>Add member</h3>
          {error ? <div className="alert alertError" style={{ marginBottom: 12 }}>{error}</div> : null}
          <form onSubmit={onSubmit} className="form" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
            <label className="label">
              Email
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </label>
            <label className="label">
              Full name
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
            </label>
            <label className="label">
              Role
              <select className="input" style={{ height: 44 }} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="director">Director</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="label">
              Department (optional)
              <input className="input" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
            </label>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Temporary password
              <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </label>
            <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
              {m.isPending ? 'Adding…' : 'Add member'}
            </button>
            <div style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>
              Seat limits apply (billing).
            </div>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Directory</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError">Failed to load team.</div> : null}
        {!q.isLoading && users.length === 0 ? <div style={{ color: 'var(--text2)' }}>No users found.</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              className="miniCard miniLink"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left' }}
              onClick={() => setPickId(u.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{u.full_name || u.email}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {u.email} · {u.role}{u.department ? ` · ${u.department}` : ''}{u.manager_name ? ` · mgr ${u.manager_name}` : ''}
                </div>
              </div>
              <span className="pill pillMuted">{u.last_login_at ? 'Active' : 'Invited'}</span>
            </button>
          ))}
        </div>
      </div>

      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}

