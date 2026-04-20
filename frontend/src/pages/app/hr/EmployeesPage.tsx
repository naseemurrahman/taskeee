import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'
import { getUser } from '../../../state/auth'
import { EmployeeDetailModal } from '../../../components/employees/EmployeeDetailModal'
import { Select } from '../../../components/ui/Select'
import { Input } from '../../../components/ui/Input'

type Employee = {
  id: string; full_name: string; status: string; title?: string | null
  department?: string | null; work_email?: string | null
  manager_name?: string | null; linked_user_email?: string | null
}

type CreatedEmployee = {
  employee?: { id?: string }
  temporaryPassword?: string | null
  tempPasswordExpires?: string | null
  notificationSent?: boolean
  message?: string
  loginEmail?: string
}

async function fetchEmployees(search: string, status: string) {
  const qs = new URLSearchParams({ page: '1', limit: '50' })
  if (search.trim()) qs.set('search', search.trim())
  if (status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ employees: Employee[] }>(`/api/v1/hris/employees?${qs.toString()}`)
  return data.employees || []
}

async function createEmployee(input: Record<string, string>) {
  const data = await apiFetch<CreatedEmployee>(`/api/v1/hris/employees`, { method: 'POST', json: input })
  if (!data?.employee?.id) throw new Error('Server did not return a new employee.')
  return { ...data, loginEmail: input.email }
}

type OrgUser = {
  id: string; email: string; full_name?: string | null; role: string
  department?: string | null; last_login_at?: string | null
}

async function fetchOrgUsers(search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '100' })
  if (search.trim()) qs.set('search', search.trim())
  const data = await apiFetch<{ users: OrgUser[] }>(`/api/v1/users?${qs.toString()}`)
  return data.users || []
}

function hashColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i)
  return `hsl(${Math.abs(h) % 360}, 65%, 55%)`
}

function copyText(text: string, btn: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    const prev = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = prev }, 2000)
  })
}

const DEPARTMENTS = [
  'Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'Finance',
  'Human Resources', 'Operations', 'Legal', 'Customer Success', 'Data & Analytics', 'Other',
]

const COUNTRY_CODES = [
  { value: '+966', label: '+966 (Saudi Arabia)' },
  { value: '+971', label: '+971 (UAE)' },
  { value: '+1', label: '+1 (US/CA)' },
  { value: '+44', label: '+44 (UK)' },
  { value: '+91', label: '+91 (India)' },
  { value: '+86', label: '+86 (China)' },
  { value: '+81', label: '+81 (Japan)' },
  { value: '+49', label: '+49 (Germany)' },
  { value: '+33', label: '+33 (France)' },
  { value: '+61', label: '+61 (Australia)' },
  { value: '+55', label: '+55 (Brazil)' },
  { value: '+7', label: '+7 (Russia)' },
  { value: '+82', label: '+82 (South Korea)' },
  { value: '+52', label: '+52 (Mexico)' },
  { value: '+31', label: '+31 (Netherlands)' },
  { value: '+34', label: '+34 (Spain)' },
  { value: '+39', label: '+39 (Italy)' },
  { value: '+46', label: '+46 (Sweden)' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'terminated', label: 'Terminated' },
]

export function EmployeesPage() {
  const me = getUser()
  const qc = useQueryClient()
  const [pickId, setPickId] = useState<string | null>(null)
  const [acctSearch, setAcctSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [formError, setFormError] = useState<string | null>(null)
  const [createdData, setCreatedData] = useState<CreatedEmployee | null>(null)

  // Form fields
  const [fullName, setFullName] = useState('')
  const [department, setDepartment] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('+966')
  const [employeeId, setEmployeeId] = useState('')
  const [designation, setDesignation] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const q = useQuery({ queryKey: ['hris', 'employees', search, status], queryFn: () => fetchEmployees(search, status) })
  const employees = useMemo(() => q.data || [], [q.data])

  const canSeeAccounts = !!me?.role && ['hr', 'director', 'admin'].includes(me.role)
  const acctQ = useQuery({
    queryKey: ['hris', 'orgUsers', acctSearch],
    queryFn: () => fetchOrgUsers(acctSearch),
    enabled: canSeeAccounts,
  })
  const orgUsers = useMemo(() => acctQ.data || [], [acctQ.data])

  const m = useMutation({
    mutationFn: createEmployee,
    onSuccess: (data) => {
      setCreatedData(data)
      setFullName(''); setDepartment(''); setEmail('')
      setPhone(''); setCountryCode('+966'); setEmployeeId(''); setDesignation('')
      setFormError(null); setFieldErrors({})
      qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hris', 'orgUsers'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.message.toLowerCase().includes('email')) {
          setFieldErrors(prev => ({ ...prev, email: err.message }))
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create employee.')
      }
    },
  })

  function validate() {
    const errs: Record<string, string> = {}
    if (!fullName.trim() || fullName.trim().length < 2) errs.fullName = 'Full name must be at least 2 characters'
    if (!department) errs.department = 'Department is required'
    if (!email.trim() || !email.includes('@')) errs.email = 'Valid email is required'
    if (!phone.trim()) errs.phone = 'Phone number is required'
    if (!employeeId.trim()) errs.employeeId = 'Employee ID is required'
    if (!designation.trim()) errs.designation = 'Designation is required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!validate()) return
    m.mutate({
      fullName: fullName.trim(),
      department,
      email: email.trim(),
      phone: phone.trim(),
      countryCode,
      employeeId: employeeId.trim(),
      designation: designation.trim(),
    })
  }

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of employees) c[e.status] = (c[e.status] || 0) + 1
    return c
  }, [employees])

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* Header */}
      <div className="dashHeaderV3">
        <div>
          <div className="dashGreetTitle" style={{ fontSize: 24 }}>👥 Employees</div>
          <div className="dashSubtitle">
            Directory and employee profiles
            {employees.length > 0 && (
              <span className="dashHeroStat good">{employees.length} total</span>
            )}
            {statusCounts['active'] && (
              <span className="dashHeroStat good">{statusCounts['active']} active</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost btnSm" to="/app/hr/time-off">Time Off</Link>
          <Link className="btn btnPrimary btnSm" to="/app/team">Team Directory</Link>
        </div>
      </div>

      {/* Created employee credentials panel */}
      {createdData && (
        <div className="credBox">
          <div className="credBoxTitle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Employee created! Share these login credentials:
          </div>
          <div className="credBoxRow">
            <span className="credBoxField">Email</span>
            <span className="credBoxValue">{createdData.loginEmail || '—'}</span>
            <button className="credBoxCopy" onClick={e => copyText(createdData.loginEmail || '', e.currentTarget)} type="button">Copy</button>
          </div>
          {createdData.temporaryPassword && (
            <div className="credBoxRow">
              <span className="credBoxField">Password</span>
              <span className="credBoxValue">{createdData.temporaryPassword}</span>
              <button className="credBoxCopy" onClick={e => copyText(createdData.temporaryPassword!, e.currentTarget)} type="button">Copy</button>
            </div>
          )}
          {createdData.tempPasswordExpires && (
            <div className="credBoxRow">
              <span className="credBoxField">Expires</span>
              <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>
                {new Date(createdData.tempPasswordExpires).toLocaleString()} (24 hours)
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>
              {createdData.notificationSent ? '📧 Welcome email also sent' : '⚠️ Email not sent — share credentials manually'}
            </span>
            <button
              type="button"
              onClick={() => setCreatedData(null)}
              style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800 }}
            >
              Dismiss ×
            </button>
          </div>
        </div>
      )}

      {/* Add Employee Form */}
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div>
            <div className="formCardV3Title">Add New Employee</div>
            <div className="formCardV3Sub">Creates a user account and employee record. Share the generated credentials.</div>
          </div>
        </div>
        <div className="formCardV3Body">
          {formError && (
            <div style={{
              padding: '12px 16px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#ef4444', fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {formError}
            </div>
          )}
          <form onSubmit={onCreate}>
            <div className="formCardV3Grid">
              <div className="formCardV3Full">
                <Input
                  label="Full Name" required
                  placeholder="e.g. Sarah Ali"
                  value={fullName}
                  onChange={e => { setFullName(e.target.value); setFieldErrors(p => ({ ...p, fullName: '' })) }}
                  error={fieldErrors.fullName}
                  icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                />
              </div>
              <Select
                label="Department" required
                value={department}
                onChange={v => { setDepartment(v); setFieldErrors(p => ({ ...p, department: '' })) }}
                options={DEPARTMENTS.map(d => ({ value: d, label: d }))}
                placeholder="Select department…"
                searchable
                error={fieldErrors.department}
              />
              <Input
                label="Designation / Job Title" required
                placeholder="e.g. Senior HR Specialist"
                value={designation}
                onChange={e => { setDesignation(e.target.value); setFieldErrors(p => ({ ...p, designation: '' })) }}
                error={fieldErrors.designation}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>}
              />
              <Input
                label="Work Email" required type="email"
                placeholder="employee@company.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: '' })) }}
                error={fieldErrors.email}
                hint="This will be their login email"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
              />
              <Input
                label="Employee ID" required
                placeholder="e.g. EMP-001"
                value={employeeId}
                onChange={e => { setEmployeeId(e.target.value); setFieldErrors(p => ({ ...p, employeeId: '' })) }}
                error={fieldErrors.employeeId}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              />
              <div>
                <label className="selectV3Label">Phone Number <span className="selectV3Required">*</span></label>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <div style={{ width: 160, flexShrink: 0 }}>
                    <Select
                      value={countryCode}
                      onChange={setCountryCode}
                      options={COUNTRY_CODES}
                      searchable
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Input
                      placeholder="5XX XXX XXXX"
                      value={phone}
                      onChange={e => { setPhone(e.target.value); setFieldErrors(p => ({ ...p, phone: '' })) }}
                      error={fieldErrors.phone}
                    />
                  </div>
                </div>
              </div>
            </div>
            <button
              className="btn btnPrimary"
              type="submit"
              disabled={m.isPending}
              style={{ width: '100%', marginTop: 20, height: 50, fontSize: 15, fontWeight: 900 }}
            >
              {m.isPending ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                  <svg className="animate-rotate" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.416" strokeDashoffset="10" opacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Creating employee account…
                </span>
              ) : '+ Add Employee & Generate Credentials'}
            </button>
          </form>
        </div>
      </div>

      {/* Filters + Directory */}
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div>
            <div className="formCardV3Title">Employee Directory</div>
            <div className="formCardV3Sub">{employees.length} employee{employees.length !== 1 ? 's' : ''} found</div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: 180 }}>
              <Select
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
            </div>
            <div style={{ width: 220 }}>
              <Input
                placeholder="Search name, email, title…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              />
            </div>
          </div>
        </div>

        {q.isError && (
          <div style={{ margin: '16px 24px', padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
            Failed to load employees. Please refresh.
          </div>
        )}

        <div style={{ overflow: 'auto' }}>
          <table className="employeeTableV3">
            <thead>
              <tr>
                <th></th>
                <th>Employee</th>
                <th>Department</th>
                <th>Title</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading employees…</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={5}>
                  <div className="emptyStateV3">
                    <div className="emptyStateV3Icon">👥</div>
                    <div className="emptyStateV3Title">No employees yet</div>
                    <div className="emptyStateV3Body">Add your first employee using the form above</div>
                  </div>
                </td></tr>
              ) : employees.map(e => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/app/hr/employees/${e.id}`}>
                  <td style={{ width: 56, padding: '12px 8px 12px 16px' }}>
                    <div className="avatarV3" style={{ background: hashColor(e.full_name) }}>
                      {e.full_name.split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{e.full_name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                      {e.work_email || e.linked_user_email || '—'}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)' }}>
                      {e.department || '—'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{e.title || '—'}</span>
                  </td>
                  <td>
                    <span className={`statusBadge ${
                      e.status === 'active' ? 'statusCompleted'
                      : e.status === 'terminated' ? 'statusOverdue'
                      : e.status === 'on_leave' ? 'statusSubmitted'
                      : 'statusPending'
                    }`}>
                      {e.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Workspace accounts (admin/hr only) */}
      {canSeeAccounts && (
        <div className="formCardV3">
          <div className="formCardV3Head">
            <div>
              <div className="formCardV3Title">Workspace Accounts</div>
              <div className="formCardV3Sub">People who can sign in · click to view task/performance data</div>
            </div>
            <div style={{ width: 220 }}>
              <Input
                placeholder="Search name or email…"
                value={acctSearch}
                onChange={e => setAcctSearch(e.target.value)}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              />
            </div>
          </div>
          <div className="formCardV3Body">
            {acctQ.isLoading && <div style={{ color: 'var(--text2)', textAlign: 'center', padding: 20 }}>Loading accounts…</div>}
            {!acctQ.isLoading && orgUsers.length === 0 && (
              <div className="emptyStateV3">
                <div className="emptyStateV3Icon">🔑</div>
                <div className="emptyStateV3Title">No accounts found</div>
              </div>
            )}
            <div style={{ display: 'grid', gap: 10 }}>
              {orgUsers.map(u => (
                <button
                  key={u.id} type="button"
                  onClick={() => setPickId(u.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 12, padding: '12px 16px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div className="avatarV3" style={{ background: hashColor(u.email) }}>
                      {(u.full_name || u.email).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 13 }}>{u.full_name || u.email}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                        {u.email} · {u.role}
                        {u.department ? ` · ${u.department}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span className={`statusBadge ${u.last_login_at ? 'statusCompleted' : 'statusPending'}`}>
                      {u.last_login_at ? 'Active' : 'Never logged in'}
                    </span>
                    <span className="statusBadge statusInProgress">{u.role}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
