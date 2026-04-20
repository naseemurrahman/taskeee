import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'
import { getUser } from '../../../state/auth'
import { EmployeeDetailModal } from '../../../components/employees/EmployeeDetailModal'

type Employee = {
  id: string
  full_name: string
  status: string
  title?: string | null
  department?: string | null
  work_email?: string | null
  manager_name?: string | null
  linked_user_email?: string | null
}

async function fetchEmployees(search: string, status: string) {
  const qs = new URLSearchParams({ page: '1', limit: '50' })
  if (search.trim()) qs.set('search', search.trim())
  if (status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ employees: Employee[] }>(`/api/v1/hris/employees?${qs.toString()}`)
  return data.employees || []
}

async function createEmployee(input: { 
  fullName: string
  department: string
  email: string
  phone: string
  countryCode: string
  employeeId: string
  designation: string
}) {
  const data = await apiFetch<{ 
    employee?: { id?: string }
    employeeRecordCreated?: boolean
    temporaryPassword?: string | null
    tempPasswordExpires?: string | null
    notificationSent?: boolean
    message?: string
  }>(`/api/v1/hris/employees`, { method: 'POST', json: input })
  const hasEmployeeId = !!(data?.employee && typeof data.employee.id === 'string' && data.employee.id.trim())
  const userOnlyCreated = data?.employeeRecordCreated === false
  if (!hasEmployeeId && !userOnlyCreated) {
    throw new Error('Server did not return a new employee.')
  }
  return data
}

type OrgUser = {
  id: string
  email: string
  full_name?: string | null
  role: string
  department?: string | null
  manager_name?: string | null
  last_login_at?: string | null
}

async function fetchOrgUsers(search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '100' })
  if (search.trim()) qs.set('search', search.trim())
  const data = await apiFetch<{ users: OrgUser[] }>(`/api/v1/users?${qs.toString()}`)
  return data.users || []
}

export function EmployeesPage() {
  const me = getUser()
  const qc = useQueryClient()
  const [pickId, setPickId] = useState<string | null>(null)
  const [acctSearch, setAcctSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | string>('all')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['hris', 'employees', search, status], queryFn: () => fetchEmployees(search, status) })
  const employees = useMemo(() => q.data || [], [q.data])

  const canSeeAccounts = !!me?.role && ['hr', 'director', 'admin'].includes(me.role)
  const acctQ = useQuery({
    queryKey: ['hris', 'orgUsers', acctSearch],
    queryFn: () => fetchOrgUsers(acctSearch),
    enabled: canSeeAccounts,
  })
  const orgUsers = useMemo(() => acctQ.data || [], [acctQ.data])

  const [fullName, setFullName] = useState('')
  const [department, setDepartment] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('+1')
  const [employeeId, setEmployeeId] = useState('')
  const [designation, setDesignation] = useState('')

  const m = useMutation({
    mutationFn: createEmployee,
    onSuccess: async (data) => {
      setFullName('')
      setDepartment('')
      setEmail('')
      setPhone('')
      setCountryCode('+1')
      setEmployeeId('')
      setDesignation('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      await qc.invalidateQueries({ queryKey: ['hris', 'orgUsers'] })
      
      // Create detailed success message with password info
      const successDiv = document.createElement('div')
      successDiv.className = 'alert alertSuccess'
      successDiv.style.marginTop = '12px'
      
      const headline = data.message || 'Employee created successfully!'
      let messageContent = `<strong>${headline}</strong><br>`
      
      if (data.temporaryPassword) {
        const expires = data.tempPasswordExpires 
          ? new Date(data.tempPasswordExpires).toLocaleString()
          : '24 hours'
        
        messageContent += `
          <div style="margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 6px;">
            <strong>Login Credentials:</strong><br>
            <strong>Email:</strong> ${email}<br>
            <strong>Password:</strong> <code style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 3px;">${data.temporaryPassword}</code><br>
            <small style="opacity: 0.8;">Expires: ${expires}</small>
          </div>
        `
        
        if (data.notificationSent) {
          messageContent += `<br><small style="opacity: 0.8;">Welcome email also sent to employee.</small>`
        } else {
          messageContent += `<br><small style="color: #fbbf24; font-weight: bold;">Please share these credentials with the employee.</small>`
        }
      } else {
        messageContent += `Welcome email sent with login credentials.`
      }
      
      successDiv.innerHTML = messageContent
      
      const form = document.querySelector('form')
      form?.parentElement?.insertBefore(successDiv, form.nextSibling)
      setTimeout(() => successDiv.remove(), 10000) // Keep longer for password info
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // Show more helpful error messages
        if (err.message.includes('already exists')) {
          setError(err.message + ' You can find them in the Employees or Directory page.')
        } else {
          setError(err.message)
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create employee.')
      }
    },
  })

  function onCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const n = fullName.trim()
    const d = department.trim()
    const emailVal = email.trim()
    const p = phone.trim()
    const eid = employeeId.trim()
    const des = designation.trim()
    
    if (n.length < 2) {
      setError('Full name must be at least 2 characters.')
      return
    }
    if (!d) {
      setError('Department is required.')
      return
    }
    if (!emailVal) {
      setError('Email is required.')
      return
    }
    if (!p) {
      setError('Phone number is required.')
      return
    }
    if (!eid) {
      setError('Employee ID is required.')
      return
    }
    if (!des) {
      setError('Designation is required.')
      return
    }
    
    m.mutate({
      fullName: n,
      department: d,
      email: emailVal,
      phone: p,
      countryCode: countryCode,
      employeeId: eid,
      designation: des,
    })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Employees</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Directory and employee profiles.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="label" style={{ margin: 0 }}>
              Status
              <select className="input" style={{ height: 40 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on_leave">On leave</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label className="label" style={{ margin: 0 }}>
              Search
              <input className="input" style={{ height: 40 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, title…" />
            </label>
          </div>
        </div>

        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load employees.</div> : null}

        <form onSubmit={onCreate} className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
          <label className="label" style={{ gridColumn: '1 / -1' }}>
            Full name *
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Sarah Ali" />
          </label>
          <label className="label">
            Department *
            <input className="input" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Human Resources" />
          </label>
          <label className="label">
            Email *
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" type="email" />
          </label>
          <label className="label">
            Employee ID *
            <input className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. EMP001" />
          </label>
          <label className="label">
            Designation (Job Title) *
            <input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. HR Specialist" />
          </label>
          <label className="label">
            Phone Number *
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="input" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ width: '100px' }}>
                <option value="+1">+1 (US)</option>
                <option value="+44">+44 (UK)</option>
                <option value="+91">+91 (India)</option>
                <option value="+86">+86 (China)</option>
                <option value="+81">+81 (Japan)</option>
                <option value="+49">+49 (Germany)</option>
                <option value="+33">+33 (France)</option>
                <option value="+61">+61 (Australia)</option>
                <option value="+971">+971 (UAE)</option>
                <option value="+966">+966 (Saudi Arabia)</option>
              </select>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="1234567890" style={{ flex: 1 }} />
            </div>
          </label>
          <button className="btn btnPrimary" type="submit" disabled={m.isPending} style={{ gridColumn: '1 / -1' }}>
            {m.isPending ? 'Creating…' : 'Add employee'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Directory</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!q.isLoading && employees.length === 0 ? <div style={{ color: 'var(--text2)' }}>No employees found.</div> : null}

        <div style={{ border: '1px solid rgba(255, 255, 255, 0.10)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.6fr', padding: '10px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: 'var(--text2)', fontWeight: 900, fontSize: 12 }}>
            <div>Employee</div>
            <div>Department</div>
            <div>Title</div>
            <div>Status</div>
          </div>
          {employees.map((e) => (
            <Link
              key={e.id}
              to={`/app/hr/employees/${e.id}`}
              style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.6fr', padding: '12px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.full_name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.work_email || e.linked_user_email || '—'}
                </div>
              </div>
              <div style={{ color: 'var(--text2)', fontWeight: 800 }}>{e.department || '—'}</div>
              <div style={{ color: 'var(--text2)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '—'}</div>
              <div style={{ fontWeight: 900 }}>{e.status}</div>
            </Link>
          ))}
        </div>
      </div>

      {canSeeAccounts ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, marginBottom: 4 }}>Workspace accounts</h3>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>People who can sign in. Select a row for tasks and performance.</div>
            </div>
            <label className="label" style={{ margin: 0 }}>
              Search
              <input className="input" style={{ height: 40 }} value={acctSearch} onChange={(e) => setAcctSearch(e.target.value)} placeholder="Name or email…" />
            </label>
          </div>
          {acctQ.isLoading ? <div style={{ marginTop: 12, color: 'var(--text2)' }}>Loading…</div> : null}
          {!acctQ.isLoading && orgUsers.length === 0 ? <div style={{ marginTop: 12, color: 'var(--text2)' }}>No accounts found.</div> : null}
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {orgUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                className="miniCard miniLink"
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left' }}
                onClick={() => setPickId(u.id)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }}>{u.full_name || u.email}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                    {u.email} · {u.role}
                    {u.department ? ` · ${u.department}` : ''}
                    {u.manager_name ? ` · mgr ${u.manager_name}` : ''}
                  </div>
                </div>
                <span className="pill pillMuted">{u.last_login_at ? 'Seen recently' : 'New'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
