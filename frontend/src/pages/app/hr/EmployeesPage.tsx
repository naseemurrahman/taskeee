import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'
import { getUser } from '../../../state/auth'
import { EmployeeDetailModal } from '../../../components/employees/EmployeeDetailModal'
import { Select } from '../../../components/ui/Select'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/Modal'

type Employee = {
  id: string; full_name: string; status: string; title?: string | null
  department?: string | null; work_email?: string | null; manager_name?: string | null
}
type CreatedEmployee = {
  employee?: { id?: string }; temporaryPassword?: string | null
  tempPasswordExpires?: string | null; notificationSent?: boolean; loginEmail?: string
}
type OrgUser = {
  id: string; email: string; full_name?: string | null; role: string
  department?: string | null; last_login_at?: string | null
}

async function fetchEmployees(search: string, status: string) {
  const qs = new URLSearchParams({ page: '1', limit: '50' })
  if (search.trim()) qs.set('search', search.trim())
  if (status !== 'all') qs.set('status', status)
  const d = await apiFetch<{ employees: Employee[] }>(`/api/v1/hris/employees?${qs}`)
  return d.employees || []
}
async function createEmployee(input: Record<string, string>) {
  const d = await apiFetch<CreatedEmployee>('/api/v1/hris/employees', { method: 'POST', json: input })
  if (!d?.employee?.id) throw new Error('Server did not return a new employee.')
  return d
}
async function fetchOrgUsers(search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '100' })
  if (search.trim()) qs.set('search', search.trim())
  const d = await apiFetch<{ users: OrgUser[] }>(`/api/v1/users?${qs}`)
  return d.users || []
}

function hashColor(s: string) {
  let h = 0; for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}
function copyText(text: string, btn: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    const p = btn.textContent; btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = p }, 2000)
  })
}

const DEPARTMENTS = ['Engineering','Product','Design','Marketing','Sales','Finance','Human Resources','Operations','Legal','Customer Success','Data & Analytics','Other']
const COUNTRY_CODES = [
  { value: '+966', label: '+966 — Saudi Arabia' },{ value: '+971', label: '+971 — UAE' },
  { value: '+1', label: '+1 — US/Canada' },{ value: '+44', label: '+44 — UK' },
  { value: '+91', label: '+91 — India' },{ value: '+86', label: '+86 — China' },
  { value: '+81', label: '+81 — Japan' },{ value: '+49', label: '+49 — Germany' },
  { value: '+33', label: '+33 — France' },{ value: '+61', label: '+61 — Australia' },
  { value: '+55', label: '+55 — Brazil' },{ value: '+82', label: '+82 — South Korea' },
]
const STATUS_OPTS = [
  { value: 'all', label: 'All statuses' },{ value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },{ value: 'on_leave', label: 'On leave' },
  { value: 'terminated', label: 'Terminated' },
]

export function EmployeesPage() {
  const me = getUser()
  const qc = useQueryClient()
  const [pickId, setPickId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [acctSearch, setAcctSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [formError, setFormError] = useState<string | null>(null)
  const [createdData, setCreatedData] = useState<CreatedEmployee & { loginEmail?: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Form state
  const [fullName, setFullName] = useState('')
  const [department, setDepartment] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('+966')
  const [employeeId, setEmployeeId] = useState('')
  const [designation, setDesignation] = useState('')

  const q = useQuery({ queryKey: ['hris', 'employees', search, status], queryFn: () => fetchEmployees(search, status) })
  const employees = useMemo(() => q.data || [], [q.data])
  const canSeeAccounts = !!me?.role && ['hr', 'director', 'admin'].includes(me.role)
  const acctQ = useQuery({ queryKey: ['hris', 'orgUsers', acctSearch], queryFn: () => fetchOrgUsers(acctSearch), enabled: canSeeAccounts })
  const orgUsers = useMemo(() => acctQ.data || [], [acctQ.data])

  function resetForm() {
    setFullName(''); setDepartment(''); setEmail(''); setPhone('')
    setCountryCode('+966'); setEmployeeId(''); setDesignation('')
    setFormError(null); setFieldErrors({})
  }

  const m = useMutation({
    mutationFn: (input: Record<string, string>) => createEmployee(input).then(d => ({ ...d, loginEmail: input.email })),
    onSuccess: (data) => {
      setCreatedData(data)
      resetForm()
      setAddOpen(false)
      qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hris', 'orgUsers'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.message.toLowerCase().includes('email')) setFieldErrors(p => ({ ...p, email: err.message }))
        else setFormError(err.message)
      } else setFormError(err instanceof Error ? err.message : 'Failed to create employee.')
    },
  })

  function validate() {
    const errs: Record<string, string> = {}
    if (!fullName.trim() || fullName.trim().length < 2) errs.fullName = 'At least 2 characters'
    if (!department) errs.department = 'Required'
    if (!email.trim() || !email.includes('@')) errs.email = 'Valid email required'
    if (!phone.trim()) errs.phone = 'Required'
    if (!employeeId.trim()) errs.employeeId = 'Required'
    if (!designation.trim()) errs.designation = 'Required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!validate()) return
    m.mutate({ fullName: fullName.trim(), department, email: email.trim(), phone: phone.trim(), countryCode, employeeId: employeeId.trim(), designation: designation.trim() })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* Credentials panel shown after creating */}
      {createdData && (
        <div className="credBox">
          <div className="credBoxTitle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Employee created! Share these login credentials:
          </div>
          {[
            { field: 'Email', value: createdData.loginEmail },
            ...(createdData.temporaryPassword ? [{ field: 'Password', value: createdData.temporaryPassword }] : []),
          ].map(row => row.value ? (
            <div key={row.field} className="credBoxRow">
              <span className="credBoxField">{row.field}</span>
              <span className="credBoxValue">{row.value}</span>
              <button className="credBoxCopy" onClick={e => copyText(row.value!, e.currentTarget)} type="button">Copy</button>
            </div>
          ) : null)}
          {createdData.tempPasswordExpires && (
            <div className="credBoxRow">
              <span className="credBoxField">Expires</span>
              <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>{new Date(createdData.tempPasswordExpires).toLocaleString()}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700 }}>
              {createdData.notificationSent ? '📧 Welcome email sent' : '⚠️ Share credentials manually'}
            </span>
            <button type="button" onClick={() => setCreatedData(null)} style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss ×</button>
          </div>
        </div>
      )}

      {/* ── Employee Directory (primary card with title + actions) ── */}
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--brand)', flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span className="formCardV3Title">Employee Directory</span>
              {employees.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'var(--brandDim)', color: 'var(--brand)', border: '1px solid var(--brandBorder)' }}>{employees.length}</span>
              )}
            </div>
            <div className="formCardV3Sub">Manage your organization's employees, view profiles, and track workspace accounts.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: 160 }}>
              <Select value={status} onChange={setStatus} options={STATUS_OPTS} />
            </div>
            <div style={{ width: 200 }}>
              <Input
                placeholder="Search name, email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              />
            </div>
            <Link className="btn btnGhost btnSm" to="/app/hr/time-off">Time Off</Link>
            <button type="button" className="btn btnPrimary btnSm" onClick={() => { resetForm(); setAddOpen(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Employee
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="employeeTableV3">
            <thead>
              <tr><th style={{ width: 52 }}></th><th>Employee</th><th>Department</th><th>Title</th><th>Status</th></tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading…</td></tr>
              ) : employees.length > 0 ? employees.map(e => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/app/hr/employees/${e.id}`}>
                  <td style={{ padding: '10px 8px 10px 16px' }}>
                    <div className="avatarV3" style={{ background: hashColor(e.full_name) }}>
                      {e.full_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{e.full_name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1 }}>{e.work_email || '—'}</div>
                  </td>
                  <td><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{e.department || '—'}</span></td>
                  <td><span style={{ fontSize: 12 }}>{e.title || '—'}</span></td>
                  <td>
                    <span className={`statusBadge ${e.status === 'active' ? 'statusCompleted' : e.status === 'terminated' ? 'statusOverdue' : e.status === 'on_leave' ? 'statusSubmitted' : 'statusPending'}`}>
                      {e.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              )) : canSeeAccounts && orgUsers.length > 0 ? (
                // Fallback: show workspace accounts in the table when no HRIS records exist
                <>
                  <tr>
                    <td colSpan={5} style={{ padding: '8px 16px 2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--brandDim)', border: '1px solid var(--brandBorder)', marginBottom: 4 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--brand)' }}>
                          Showing workspace accounts — use "Add Employee" to create full HRIS records with departments, titles and more.
                        </span>
                      </div>
                    </td>
                  </tr>
                  {orgUsers.map(u => (
                    <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setPickId(u.id)}>
                      <td style={{ padding: '10px 8px 10px 16px' }}>
                        <div className="avatarV3" style={{ background: hashColor(u.email) }}>
                          {(u.full_name || u.email).charAt(0).toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{u.full_name || u.email}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1 }}>{u.email}</div>
                      </td>
                      <td><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>—</span></td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'rgba(99,102,241,0.10)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.22)', textTransform: 'capitalize' }}>{u.role}</span>
                      </td>
                      <td>
                        <span className={`statusBadge ${u.last_login_at ? 'statusCompleted' : 'statusPending'}`}>{u.last_login_at ? 'Active' : 'New'}</span>
                      </td>
                    </tr>
                  ))}
                </>
              ) : (
                <tr><td colSpan={5}>
                  <div className="emptyStateV3">
                    <div className="emptyStateV3Icon">👥</div>
                    <div className="emptyStateV3Title">No employees yet</div>
                    <div className="emptyStateV3Body">Click "Add Employee" to create your first employee record.</div>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Workspace Accounts ── */}
      {canSeeAccounts && (
        <div className="formCardV3">
          <div className="formCardV3Head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--brand)', flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span className="formCardV3Title">Workspace Accounts</span>
                {orgUsers.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'var(--brandDim)', color: 'var(--brand)', border: '1px solid var(--brandBorder)' }}>{orgUsers.length}</span>
                )}
              </div>
              <div className="formCardV3Sub">People with sign-in access — click to view task activity</div>
            </div>
            <div style={{ width: 200 }}>
              <Input placeholder="Search…" value={acctSearch} onChange={e => setAcctSearch(e.target.value)}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              />
            </div>
          </div>
          <div className="formCardV3Body">
            {!acctQ.isLoading && orgUsers.length === 0 && <div className="emptyStateV3"><div className="emptyStateV3Icon">🔑</div><div className="emptyStateV3Title">No accounts found</div></div>}
            <div style={{ display: 'grid', gap: 6 }}>
              {orgUsers.map(u => (
                <button key={u.id} type="button" onClick={() => setPickId(u.id)}
                  className="workspaceUserRow"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg1)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.13s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brandBorder)'; e.currentTarget.style.background = 'var(--surfaceUp)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg1)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div className="avatarV3" style={{ background: hashColor(u.email) }}>{(u.full_name || u.email).charAt(0).toUpperCase()}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>{u.full_name || u.email}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1 }}>{u.email} · {u.role}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <span className={`statusBadge ${u.last_login_at ? 'statusCompleted' : 'statusPending'}`}>{u.last_login_at ? 'Active' : 'New'}</span>
                    <span className="statusBadge statusInProgress">{u.role}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Add Employee Modal ── */}
      <Modal
        title="Add New Employee"
        subtitle="Creates a user account and employee record"
        open={addOpen}
        onClose={() => { setAddOpen(false); resetForm() }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>}
        wide
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btnGhost" onClick={() => { setAddOpen(false); resetForm() }}>Cancel</button>
            <button type="submit" form="addEmpForm" className="btn btnPrimary" disabled={m.isPending}>
              {m.isPending ? 'Creating…' : '+ Add Employee & Generate Credentials'}
            </button>
          </div>
        }
      >
        {formError && (
          <div className="alertV4 alertV4Error" style={{ marginBottom: 14 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {formError}
          </div>
        )}
        <form id="addEmpForm" onSubmit={onCreate} style={{ display: 'grid', gap: 14 }}>
          <Input
            label="Full Name" required placeholder="e.g. Sarah Ali"
            value={fullName} onChange={e => { setFullName(e.target.value); setFieldErrors(p => ({ ...p, fullName: '' })) }}
            error={fieldErrors.fullName}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Select
              label="Department" required value={department}
              onChange={v => { setDepartment(v); setFieldErrors(p => ({ ...p, department: '' })) }}
              options={DEPARTMENTS.map(d => ({ value: d, label: d }))}
              placeholder="Select department…" searchable error={fieldErrors.department}
            />
            <Input
              label="Designation / Job Title" required placeholder="e.g. HR Specialist"
              value={designation} onChange={e => { setDesignation(e.target.value); setFieldErrors(p => ({ ...p, designation: '' })) }}
              error={fieldErrors.designation}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Input
              label="Work Email" required type="email" placeholder="employee@company.com"
              value={email} onChange={e => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: '' })) }}
              error={fieldErrors.email} hint="This will be their login email"
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
            />
            <Input
              label="Employee ID" required placeholder="e.g. EMP-001"
              value={employeeId} onChange={e => { setEmployeeId(e.target.value); setFieldErrors(p => ({ ...p, employeeId: '' })) }}
              error={fieldErrors.employeeId}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            />
          </div>
          <div>
            <label className="selectV3Label">Phone Number <span className="selectV3Required">*</span></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <div style={{ width: 200, flexShrink: 0 }}>
                <Select value={countryCode} onChange={setCountryCode} options={COUNTRY_CODES} searchable />
              </div>
              <div style={{ flex: 1 }}>
                <Input placeholder="5XX XXX XXXX" value={phone}
                  onChange={e => { setPhone(e.target.value); setFieldErrors(p => ({ ...p, phone: '' })) }}
                  error={fieldErrors.phone}
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <EmployeeDetailModal userId={pickId} onClose={() => setPickId(null)} />
    </div>
  )
}
