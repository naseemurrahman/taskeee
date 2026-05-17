import { useMemo, useState, type FormEvent } from 'react'
import { IconKey } from '../../../components/ui/AppIcons'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'
import { getUser } from '../../../state/auth'
import { EmployeeDetailModal } from '../../../components/employees/EmployeeDetailModal'
import { Select } from '../../../components/ui/Select'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/Modal'
import { useToast } from '../../../components/ui/ToastSystem'
import { useRealtimeInvalidation } from '../../../lib/socket'

type Employee = {
  id: string; full_name: string; status: string; title?: string | null
  department?: string | null; work_email?: string | null; manager_name?: string | null
}
type ActiveTaskForEmp = { id: string; title: string; status: string; project_name?: string | null; due_date?: string | null }
type CreatedEmployee = {
  employee?: { id?: string }; temporaryPassword?: string | null
  tempPasswordExpires?: string | null; notificationSent?: boolean; loginEmail?: string
}
type OrgUser = {
  id: string; email: string; full_name?: string | null; role: string
  department?: string | null; last_login_at?: string | null
}

const EMP_STATUS_OPTS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'terminated', label: 'Terminated' },
]

const EMP_PAGE_SIZE = 25

async function fetchEmployees(search: string, status: string, page: number) {
  const qs = new URLSearchParams({ page: String(page), limit: String(EMP_PAGE_SIZE) })
  if (search.trim()) qs.set('search', search.trim())
  if (status !== 'all') qs.set('status', status)
  const d = await apiFetch<{ employees: Employee[]; total?: number }>(`/api/v1/hris/employees?${qs}`)
  return { employees: d.employees || [], total: d.total || 0 }
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

const DEPARTMENTS = [
  'IT', 'Technical', 'Engineering', 'Software Development', 'Infrastructure',
  'Cybersecurity', 'Data & Analytics', 'AI & Machine Learning',
  'Human Resources', 'Finance', 'Accounting', 'Legal',
  'Sales', 'Marketing', 'Customer Success', 'Customer Support',
  'Operations', 'Product', 'Design', 'Research & Development',
  'Project Management', 'Business Development', 'Procurement',
  'Quality Assurance', 'Administration', 'Executive', 'Other',
]
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
  const { success: toastSuccess, error: toastError } = useToast()
  useRealtimeInvalidation({ employees: true })
  const [pickId, setPickId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [acctSearch, setAcctSearch] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [empPage, setEmpPage] = useState(1)
  const handleEmpSearch = (v: string) => { setSearch(v); setEmpPage(1) }
  const handleEmpStatus = (v: string) => { setStatus(v); setEmpPage(1) }
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
  const [roleType, setRoleType] = useState('')

  const q = useQuery({ queryKey: ['hris', 'employees', search, status, empPage], queryFn: () => fetchEmployees(search, status, empPage) })
  const employees = useMemo(() => q.data?.employees || [], [q.data])
  const canSeeAccounts = !!me?.role && ['hr', 'director', 'admin'].includes(me.role)
  const acctQ = useQuery({ queryKey: ['hris', 'orgUsers', acctSearch], queryFn: () => fetchOrgUsers(acctSearch), enabled: canSeeAccounts })
  const orgUsers = useMemo(() => acctQ.data || [], [acctQ.data])

  function resetForm() {
    setFullName(''); setDepartment(''); setEmail(''); setPhone('')
    setCountryCode('+966'); setEmployeeId(''); setDesignation(''); setRoleType('')
    setFormError(null); setFieldErrors({})
  }

  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [terminateActiveTasks, setTerminateActiveTasks] = useState<ActiveTaskForEmp[]>([])
  const [terminateLoading, setTerminateLoading] = useState(false)
  const [statusChangeTarget, setStatusChangeTarget] = useState<{ emp: Employee; newStatus: string } | null>(null)

  // ── Per-employee status change ─────────────────────────────────────────────
  const statusChangeM = useMutation({
    mutationFn: ({ empId, status }: { empId: string; status: string }) =>
      apiFetch(`/api/v1/hris/employees/${empId}`, { method: 'PATCH', json: { status } }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      toastSuccess('Status updated', `Employee status changed to ${vars.status.replace(/_/g, ' ')}`)
      setStatusChangeTarget(null)
    },
    onError: (err: any) => toastError('Update failed', err?.message || 'Could not update status'),
  })

  const deleteEmpM = useMutation({
    mutationFn: (empId: string) => apiFetch(`/api/v1/hris/employees/${empId}`, { method: 'DELETE' }),
    onSuccess: () => {
      const name = deleteTarget?.full_name || 'Employee'
      setDeleteTarget(null); setTerminateActiveTasks([])
      qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hris', 'orgUsers'] })
      toastSuccess('Employee removed', `${name} has been removed.`)
    },
    onError: (err: any) => toastError('Remove failed', err?.message || 'Could not remove employee'),
  })

  async function handleDeleteClick(emp: Employee) {
    setDeleteTarget(emp)
    setTerminateLoading(true)
    try {
      const d = await apiFetch<{ tasks: ActiveTaskForEmp[] }>(`/api/v1/hris/employees/${emp.id}/active-tasks`)
      setTerminateActiveTasks(d.tasks || [])
    } catch {
      setTerminateActiveTasks([])
    } finally {
      setTerminateLoading(false)
    }
  }

  const m = useMutation({
    mutationFn: (input: Record<string, string>) => createEmployee(input).then(d => ({ ...d, loginEmail: input.email })),
    onSuccess: (data) => {
      setCreatedData(data)
      resetForm()
      setAddOpen(false)
      qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hris', 'orgUsers'] })
      toastSuccess('Employee added', `${(data as any)?.employee?.full_name || fullName} has been added.`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.message.toLowerCase().includes('email')) setFieldErrors(p => ({ ...p, email: err.message }))
        else setFormError(err.message)
      } else setFormError(err instanceof Error ? err.message : 'Failed to create employee.')
      toastError('Create failed', err instanceof ApiError ? err.message : 'Failed to add employee.')
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
    if (!roleType) errs.roleType = 'Required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!validate()) return
    const normalizedDesignation = designation.trim()
    m.mutate({
      fullName: fullName.trim(),
      department,
      email: email.trim(),
      phone: phone.trim(),
      countryCode,
      employeeId: employeeId.trim(),
      designation: normalizedDesignation,
      title: normalizedDesignation,
      roleType,
      role: roleType,  // maps to users.role in the backend
    })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* KPI Cards */}
      <div className="grid4">
        <div className="miniCard" style={{ '--kpi-color': '#6366f1' } as any}>
          <div className="miniLabel">Total Employees</div>
          <div className="miniValue">{pagination?.total || employees.length}</div>
        </div>
        <div className="miniCard" style={{ '--kpi-color': '#22c55e' } as any}>
          <div className="miniLabel">Active</div>
          <div className="miniValue">{employees.filter(e => e.status === 'active').length}</div>
        </div>
        <div className="miniCard" style={{ '--kpi-color': '#eab308' } as any}>
          <div className="miniLabel">On Leave</div>
          <div className="miniValue">{employees.filter(e => e.status === 'on_leave').length}</div>
        </div>
        <div className="miniCard" style={{ '--kpi-color': '#a855f7' } as any}>
          <div className="miniLabel">Departments</div>
          <div className="miniValue">{new Set(employees.map(e => e.department).filter(Boolean)).size}</div>
        </div>
      </div>

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

      {/* ── Page Header ── */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Employee Directory
              {employees.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, padding: '2px 10px', borderRadius: 999, background: 'var(--brandDim)', color: 'var(--brand)', border: '1px solid var(--brandBorder)', marginLeft: 4 }}>{employees.length}</span>}
            </div>
            <div className="pageHeaderCardSub">Manage your organization's employees, view profiles, and track workspace accounts.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link className="btn btnGhost" to="/app/hr/time-off" style={{ height: 38, padding: '0 16px', fontSize: 13 }}>Time Off</Link>
            <button type="button" onClick={() => { resetForm(); setAddOpen(true) }}
              style={{ height: 38, padding: '0 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(315deg,rgba(249,230,162,1.0),rgba(226,171,65,1.0))', color: '#1a1200', fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Employee
            </button>
          </div>
        </div>
      </div>

      {/* ── Filters Bar ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '2 1 200px', minWidth: 160, maxWidth: 360 }}>
          <Input placeholder="Search name, email, department…" value={search} onChange={e => handleEmpSearch(e.target.value)}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
          />
        </div>
        <div style={{ flex: '1 1 140px', minWidth: 120, maxWidth: 200 }}>
          <Select value={status} onChange={handleEmpStatus} options={STATUS_OPTS} />
        </div>
      </div>

      {/* ── Employee Grid ── */}
      {q.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ height: 120, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--brandDim)', border: '1px solid var(--brandBorder)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--brand)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>No employees found</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{search ? 'Try different search terms or clear filters.' : 'Get started by adding your first employee.'}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 12 }}>
          {employees.map(e => {
            const initials = e.full_name.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()
            const statusColor = e.status === 'active' ? '#22c55e' : e.status === 'terminated' ? '#ef4444' : e.status === 'on_leave' ? '#38bdf8' : '#94a3b8'
            const statusLabel = (e.status || 'active').replace(/_/g, ' ')
            const statusBg = e.status === 'active' ? 'rgba(34,197,94,0.1)' : e.status === 'terminated' ? 'rgba(239,68,68,0.1)' : e.status === 'on_leave' ? 'rgba(56,189,248,0.1)' : 'rgba(148,163,184,0.1)'
            return (
              <div key={e.id} style={{
                  position: 'relative', borderRadius: 18,
                  background: `linear-gradient(145deg, color-mix(in srgb, ${hashColor(e.full_name)} 8%, var(--surface)), var(--surface))`,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
                  overflow: 'hidden', transition: 'transform 0.18s cubic-bezier(0.4,0,0.2,1), box-shadow 0.18s'
                }}
                onMouseEnter={ev => { ev.currentTarget.style.transform = 'translateY(-3px)'; ev.currentTarget.style.boxShadow = `0 12px 36px rgba(0,0,0,0.22), 0 0 0 1px ${hashColor(e.full_name)}30` }}
                onMouseLeave={ev => { ev.currentTarget.style.transform = ''; ev.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)' }}>
                {/* Subtle left accent */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: hashColor(e.full_name), borderRadius: '18px 0 0 18px' }} />
                {/* Card body — clickable */}
                <a href={`/app/hr/employees/${e.id}`} style={{ display: 'block', padding: '18px 18px 14px 22px', textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {/* Avatar with glow */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 52, height: 52, borderRadius: 15, background: `linear-gradient(135deg, ${hashColor(e.full_name)}, ${hashColor(e.full_name)}bb)`, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
                        {initials}
                      </div>
                      <div style={{ position: 'absolute', bottom: -2, right: -2, width: 13, height: 13, borderRadius: '50%', background: statusColor, border: '2px solid var(--surface)' }} />
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{e.full_name}</div>
                      {e.title && <div style={{ fontSize: 11, color: hashColor(e.full_name), fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3, filter: 'brightness(1.3)' }}>{e.title}</div>}
                      <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.work_email || '—'}</div>
                    </div>
                  </div>
                  {/* Status + dept row */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: statusBg, color: statusColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor }} />{statusLabel}
                    </span>
                    {e.department && <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', color: 'var(--muted)' }}>{e.department}</span>}
                    {e.manager_name && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>↑ {e.manager_name}</span>}
                  </div>
                </a>
                {/* Slim action row — no hard border, just translucent bg */}
                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)' }} onClick={ev => ev.stopPropagation()}>
                  <button type="button" onClick={() => setStatusChangeTarget({ emp: e, newStatus: e.status || 'active' })}
                    style={{ flex: 1, height: 34, border: 'none', borderRight: '1px solid rgba(255,255,255,0.05)', background: 'transparent', color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'color 0.12s, background 0.12s' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.06)'; ev.currentTarget.style.color = 'var(--text)' }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                    Set Status
                  </button>
                  <button type="button" onClick={() => handleDeleteClick(e)} title="Remove employee"
                    style={{ width: 42, height: 34, border: 'none', background: 'transparent', color: 'rgba(239,68,68,0.35)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'color 0.12s, background 0.12s', flexShrink: 0 }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(239,68,68,0.1)'; ev.currentTarget.style.color = '#ef4444' }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.color = 'rgba(239,68,68,0.35)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Workspace Accounts — only show when HRIS employees exist (otherwise directory table above already shows them) */}
      {canSeeAccounts && employees.length > 0 && (
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
            <div style={{ flex: '1 1 160px', minWidth: 120, maxWidth: 280 }}>
              <Input placeholder="Search…" value={acctSearch} onChange={e => setAcctSearch(e.target.value)}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              />
            </div>
          </div>
          <div className="formCardV3Body">
            {!acctQ.isLoading && orgUsers.length === 0 && <div className="emptyStateV3"><div className="emptyStateV3Icon"><IconKey size={14} /></div><div className="emptyStateV3Title">No accounts found</div></div>}
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

      {/* ── Status Change Modal ── */}
      {statusChangeTarget && (
        <div className="modalOverlayV2" onMouseDown={() => { if (!statusChangeM.isPending) setStatusChangeTarget(null) }}>
          <div className="modalCardV2" style={{ maxWidth: 380 }} onMouseDown={e => e.stopPropagation()}>
            <div className="modalV2Head">
              <div>
                <div className="modalV2Title">Change Employee Status</div>
                <div className="modalV2Sub">{statusChangeTarget.emp.full_name}</div>
              </div>
              <button className="modalV2Close" onClick={() => setStatusChangeTarget(null)} type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="modalV2Body" style={{ display: 'grid', gap: 8 }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text2)' }}>Select the new status for this employee. This will be logged.</p>
              {EMP_STATUS_OPTS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => statusChangeM.mutate({ empId: statusChangeTarget.emp.id, status: opt.value })}
                  disabled={statusChangeM.isPending || opt.value === statusChangeTarget.emp.status}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: opt.value === statusChangeTarget.emp.status ? 'var(--brandDim)' : 'var(--bg2)', cursor: opt.value === statusChangeTarget.emp.status ? 'default' : 'pointer', textAlign: 'left', width: '100%' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: opt.value === 'active' ? '#22c55e' : opt.value === 'terminated' ? '#ef4444' : opt.value === 'on_leave' ? '#38bdf8' : '#94a3b8', flexShrink: 0 }} />
                  <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>{opt.label}</span>
                  {opt.value === statusChangeTarget.emp.status && <span style={{ fontSize: 10, color: 'var(--brand)', fontWeight: 700, marginLeft: 'auto' }}>Current</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete / Terminate Employee Confirm ── */}
      {deleteTarget && (
        <div className="modalOverlayV2" onMouseDown={() => { if (!deleteEmpM.isPending) { setDeleteTarget(null); setTerminateActiveTasks([]) } }}>
          <div className="modalCardV2" style={{ maxWidth: 480 }} onMouseDown={e => e.stopPropagation()}>
            <div className="modalV2Head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </div>
                <div>
                  <div className="modalV2Title">Remove Employee</div>
                  <div className="modalV2Sub">This will deactivate their account</div>
                </div>
              </div>
              <button className="modalV2Close" onClick={() => { setDeleteTarget(null); setTerminateActiveTasks([]) }} type="button" disabled={deleteEmpM.isPending}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modalV2Body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', marginBottom: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--brandDim)', border: '1.5px solid var(--brandBorder)', color: 'var(--brand)', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
                  {deleteTarget.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--text)' }}>{deleteTarget.full_name}</div>
                  {deleteTarget.title && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{deleteTarget.title}</div>}
                </div>
              </div>

              {/* Active tasks warning */}
              {terminateLoading ? (
                <div style={{ padding: '12px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Checking active tasks…</div>
              ) : terminateActiveTasks.length > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 10 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>
                      ⚠️ This employee has {terminateActiveTasks.length} active task{terminateActiveTasks.length > 1 ? 's' : ''} assigned
                    </span>
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                    {terminateActiveTasks.map(t => (
                      <div key={t.id} style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 12 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0, marginTop: 4 }} />
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{t.title}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {t.status.replace(/_/g, ' ')}{t.project_name ? ` · ${t.project_name}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>
                    ⚠️ Please reassign these tasks before removing this employee, or they will become unassigned.
                  </p>
                </div>
              ) : null}

              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text2)' }}>
                Removing <strong>{deleteTarget.full_name}</strong> will <strong>delete their HRIS record</strong> and <strong>deactivate their login</strong>.
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#ef4444', fontWeight: 700 }}>⚠️ This action cannot be undone.</p>
            </div>
            <div className="modalV2Foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btnGhost" onClick={() => { setDeleteTarget(null); setTerminateActiveTasks([]) }} disabled={deleteEmpM.isPending}>Cancel</button>
              <button
                type="button"
                disabled={deleteEmpM.isPending}
                onClick={() => deleteEmpM.mutate(deleteTarget.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 38, borderRadius: 999, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 13, cursor: deleteEmpM.isPending ? 'not-allowed' : 'pointer', opacity: deleteEmpM.isPending ? 0.7 : 1 }}
              >
                {deleteEmpM.isPending
                  ? <><svg className="animate-rotate" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg> Removing…</>
                  : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> {terminateActiveTasks.length > 0 ? 'Remove Anyway' : 'Remove Employee'}</>
                }
              </button>
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
            <Select
              label="Role Type" required value={roleType}
              onChange={v => { setRoleType(v); setFieldErrors(p => ({ ...p, roleType: '' })) }}
              options={[
                { value: 'employee', label: 'Employee', description: 'Standard team member' },
                { value: 'manager', label: 'Manager', description: 'Team or department lead' },
                { value: 'technician', label: 'Technician', description: 'Technical specialist' },
              ]}
              placeholder="Select role…" error={fieldErrors.roleType}
            />
            <Input
              label="Employee ID" required placeholder="e.g. EMP-001"
              value={employeeId} onChange={e => { setEmployeeId(e.target.value); setFieldErrors(p => ({ ...p, employeeId: '' })) }}
              error={fieldErrors.employeeId}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            />
          </div>
          <Input
            label="Work Email" required type="email" placeholder="employee@company.com"
            value={email} onChange={e => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: '' })) }}
            error={fieldErrors.email} hint="This will be their login email"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
          />
          <div>
            <label className="selectV3Label">Phone Number <span className="selectV3Required">*</span></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <div style={{ flex: '1 1 160px', minWidth: 120, maxWidth: 280 }}>
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
