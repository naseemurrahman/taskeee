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
  avatar_url?: string | null
}

async function fetchUsers(search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '80' })
  if (search.trim()) qs.set('search', search.trim())
  const data = await apiFetch<{ users: UserRow[] }>(`/api/v1/users?${qs.toString()}`)
  return data.users || []
}

async function createUser(input: {
  email: string
  password: string
  fullName: string
  role: string
  department?: string
}) {
  return await apiFetch(`/api/v1/users`, { method: 'POST', json: input })
}

const ROLE_CONFIG: Record<string, { color: string; bg: string }> = {
  admin:      { color: '#f4ca57', bg: 'rgba(244,202,87,0.12)' },
  director:   { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  hr:         { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  manager:    { color: '#6d5efc', bg: 'rgba(109,94,252,0.12)' },
  supervisor: { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  employee:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
}

function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['#f4ca57', '#6d5efc', '#10b981', '#38bdf8', '#f97316', '#a78bfa', '#ef4444']
  const color = colors[(initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % colors.length]
  return (
    <div style={{
      width: size, height: size,
      borderRadius: size / 3.5,
      flexShrink: 0,
      background: `${color}18`,
      border: `1.5px solid ${color}35`,
      display: 'grid',
      placeItems: 'center',
      fontSize: size * 0.36,
      fontWeight: 950,
      color,
      letterSpacing: '-0.5px',
    }}>
      {initials}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] || { color: 'var(--text2)', bg: 'rgba(255,255,255,0.06)' }
  return (
    <span style={{
      padding: '3px 9px',
      borderRadius: 99,
      background: cfg.bg,
      color: cfg.color,
      fontSize: 11,
      fontWeight: 800,
      border: `1px solid ${cfg.color}25`,
      textTransform: 'capitalize',
      letterSpacing: '0.02em',
    }}>
      {role}
    </span>
  )
}

export function TeamPage() {
  const me = getUser()
  const qc = useQueryClient()
  const [pickId, setPickId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const q = useQuery({ queryKey: ['team', 'users', search], queryFn: () => fetchUsers(search) })
  const users = useMemo(() => {
    const all = q.data || []
    return roleFilter === 'all' ? all : all.filter(u => u.role === roleFilter)
  }, [q.data, roleFilter])

  const roleCounts = useMemo(() => {
    const all = q.data || []
    return Object.keys(ROLE_CONFIG).reduce((acc, r) => {
      acc[r] = all.filter(u => u.role === r).length
      return acc
    }, {} as Record<string, number>)
  }, [q.data])

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('employee')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const m = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setEmail(''); setFullName(''); setPassword(''); setDepartment(''); setError(null)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 4000)
      await qc.invalidateQueries({ queryKey: ['team', 'users'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message.includes('already exists')
          ? err.message + ' Find them in the Directory below.'
          : err.message)
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

  const canAdd = me?.role && ['director', 'admin', 'manager'].includes(me.role)

  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, letterSpacing: '-0.6px', fontSize: 22 }}>Team Directory</h2>
          <div style={{ color: 'var(--text2)', marginTop: 3, fontSize: 13 }}>
            {q.data?.length ?? '—'} members · Role-scoped view
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canAdd && (
            <button
              type="button"
              className={`btn ${showAddForm ? 'btnGhost' : 'btnPrimary'} btnSm`}
              onClick={() => setShowAddForm(v => !v)}
            >
              {showAddForm ? '✕ Cancel' : '+ Add member'}
            </button>
          )}
        </div>
      </div>

      {/* Add member form */}
      {canAdd && showAddForm && (
        <div className="card animate-fadeInUp">
          <div style={{ fontWeight: 950, letterSpacing: '-0.3px', marginBottom: 16, fontSize: 16 }}>Add team member</div>
          {success && (
            <div className="alert alertSuccess animate-fadeIn" style={{ marginBottom: 12 }}>
              ✓ Member added — employee record created automatically.
            </div>
          )}
          {error && <div className="alert alertError animate-fadeIn" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="label">
              Email
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required />
            </label>
            <label className="label">
              Full name
              <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" required />
            </label>
            <label className="label">
              Role
              <select className="input" style={{ height: 44 }} value={role} onChange={e => setRole(e.target.value)}>
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="director">Director</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="label">
              Department
              <input className="input" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering (optional)" />
            </label>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Temporary password
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" required />
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
                {m.isPending ? 'Adding…' : 'Add member'}
              </button>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>Seat limits apply per billing plan.</span>
            </div>
          </form>
        </div>
      )}

      {/* Role filter + search */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setRoleFilter('all')}
              style={{
                padding: '5px 12px', borderRadius: 99, border: '1px solid',
                cursor: 'pointer', fontSize: 12, fontWeight: 800,
                borderColor: roleFilter === 'all' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                background: roleFilter === 'all' ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: roleFilter === 'all' ? 'var(--text)' : 'var(--text2)',
              }}
            >
              All <span style={{ opacity: 0.6 }}>{q.data?.length ?? 0}</span>
            </button>
            {Object.entries(ROLE_CONFIG).map(([r, cfg]) => roleCounts[r] > 0 && (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                style={{
                  padding: '5px 12px', borderRadius: 99, border: '1px solid',
                  cursor: 'pointer', fontSize: 12, fontWeight: 800,
                  borderColor: roleFilter === r ? `${cfg.color}40` : 'rgba(255,255,255,0.08)',
                  background: roleFilter === r ? cfg.bg : 'transparent',
                  color: roleFilter === r ? cfg.color : 'var(--text2)',
                  textTransform: 'capitalize',
                }}
              >
                {r} <span style={{ opacity: 0.6 }}>{roleCounts[r]}</span>
              </button>
            ))}
          </div>
          <input
            className="input"
            style={{ height: 36, width: 220, fontSize: 13 }}
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Directory grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeletonCard" style={{ height: 100 }} />
        ))}
        {q.isError && <div className="alert alertError">Failed to load team.</div>}
        {!q.isLoading && users.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '32px 0', color: 'var(--text2)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
            No members found.
          </div>
        )}
        {users.map(u => (
          <button
            key={u.id}
            type="button"
            onClick={() => setPickId(u.id)}
            style={{
              textAlign: 'left', cursor: 'pointer', width: '100%',
              padding: '16px', borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar name={u.full_name} size={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
                  {u.full_name || u.email}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email}
                </div>
              </div>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: u.last_login_at ? '#10b981' : 'rgba(255,255,255,0.2)',
              }} title={u.last_login_at ? 'Active' : 'Never logged in'} />
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <RoleBadge role={u.role} />
              {u.department && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
                  {u.department}
                </span>
              )}
              {u.manager_name && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  · Mgr: {u.manager_name}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
