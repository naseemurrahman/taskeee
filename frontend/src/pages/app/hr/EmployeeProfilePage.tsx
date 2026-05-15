import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Employee = {
  id: string
  user_id?: string | null
  full_name: string
  status: string
  title?: string | null
  department?: string | null
  location?: string | null
  hire_date?: string | null
  work_email?: string | null
  phone_e164?: string | null
  manager_id?: string | null
  manager_name?: string | null
  linked_user_email?: string | null
}

type EmployeePatch = {
  fullName?: string
  status?: string
  title?: string | null
  department?: string | null
  location?: string | null
  workEmail?: string | null
  phoneE164?: string | null
}

type TaskRow = {
  id: string
  title: string
  status?: string | null
  priority?: string | null
  due_date?: string | null
}

type TimeOffRow = {
  id: string
  employee_id?: string | null
  employee_name?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
  reason?: string | null
}

type ActivityRow = {
  id?: string
  activity_type?: string | null
  type?: string | null
  action?: string | null
  event_type?: string | null
  note?: string | null
  created_at?: string | null
}

type TabKey = 'dashboard' | 'profile' | 'tasks' | 'timeOff' | 'activity'

async function fetchEmployee(id: string) {
  const data = await apiFetch<{ employee: Employee }>(`/api/v1/hris/employees/${encodeURIComponent(id)}`)
  return data.employee
}

async function updateEmployee(input: { id: string; patch: EmployeePatch }) {
  return await apiFetch<{ employee: Employee }>(`/api/v1/hris/employees/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    json: input.patch,
  })
}

async function fetchEmployeeTasks(employee?: Employee | null) {
  if (!employee) return [] as TaskRow[]
  // ONLY use user_id (users table UUID) — tasks.assigned_to stores users.id, not employees.id
  // Using employee.id as a fallback would return wrong or all-org tasks
  const userId = employee.user_id
  if (!userId) return [] as TaskRow[]
  try {
    const data = await apiFetch<{ tasks?: TaskRow[] }>(`/api/v1/tasks?userId=${encodeURIComponent(userId)}&limit=200`)
    return (data.tasks || []).filter(t => t?.id)
  } catch {
    return [] as TaskRow[]
  }
}

async function fetchEmployeeTimeOff(employee?: Employee | null) {
  if (!employee) return [] as TimeOffRow[]
  try {
    const data = await apiFetch<{ requests?: TimeOffRow[] }>('/api/v1/hris/time-off/requests')
    const requests = data.requests || []
    return requests.filter((request) => {
      if (request.employee_id && request.employee_id === employee.id) return true
      if (request.employee_name && employee.full_name && request.employee_name === employee.full_name) return true
      return false
    })
  } catch {
    return []
  }
}

async function fetchEmployeeActivity(employee?: Employee | null) {
  if (!employee?.user_id) return [] as ActivityRow[]
  try {
    const data = await apiFetch<{ activities?: ActivityRow[]; activity?: ActivityRow[] }>(`/api/v1/activity?userId=${encodeURIComponent(employee.user_id)}&limit=50`)
    return data.activities || data.activity || []
  } catch {
    return []
  }
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function titleCase(value?: string | null) {
  if (!value) return 'Unknown'
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function SectionEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ marginTop: 12, padding: 16, color: 'var(--text2)' }}>
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      <div style={{ marginTop: 4 }}>{body}</div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="card" style={{ padding: 14, minHeight: 86 }}>
      <div style={{ color: 'var(--text2)', fontSize: 12, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 24, fontWeight: 950, overflowWrap: 'anywhere' }}>{value ?? '—'}</div>
    </div>
  )
}

export function EmployeeProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const empId = id || ''
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')

  const q = useQuery({ queryKey: ['hris', 'employee', empId], queryFn: () => fetchEmployee(empId), enabled: !!empId })
  const employee = q.data

  const tasksQ = useQuery({
    queryKey: ['hris', 'employee', empId, 'tasks', employee?.user_id || null],
    queryFn: () => fetchEmployeeTasks(employee),
    enabled: !!employee,
    staleTime: 30_000,
  })

  const timeOffQ = useQuery({
    queryKey: ['hris', 'employee', empId, 'time-off'],
    queryFn: () => fetchEmployeeTimeOff(employee),
    enabled: !!employee,
    staleTime: 30_000,
  })

  const activityQ = useQuery({
    queryKey: ['hris', 'employee', empId, 'activity', employee?.user_id || null],
    queryFn: () => fetchEmployeeActivity(employee),
    enabled: !!employee,
    staleTime: 30_000,
  })

  const tasks = tasksQ.data || []
  const timeOff = timeOffQ.data || []
  const activity = activityQ.data || []

  const stats = useMemo(() => {
    const isClosed = (status?: string | null) => ['completed', 'manager_approved', 'done'].includes(String(status || '').toLowerCase())
    const open = tasks.filter((task) => !isClosed(task.status)).length
    const completed = tasks.length - open
    const overdue = tasks.filter((task) => task.due_date && new Date(task.due_date) < new Date() && !isClosed(task.status)).length
    return { totalTasks: tasks.length, open, completed, overdue, timeOff: timeOff.length }
  }, [tasks, timeOff])

  const m = useMutation({
    mutationFn: updateEmployee,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['hris', 'employee', empId] })
      await qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Update failed.')
    },
  })

  function onSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!empId) return
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const fullName = String(fd.get('fullName') || '').trim()
    const title = String(fd.get('title') || '').trim()
    const department = String(fd.get('department') || '').trim()
    const location = String(fd.get('location') || '').trim()
    const workEmail = String(fd.get('workEmail') || '').trim()
    const phoneE164 = String(fd.get('phoneE164') || '').trim()
    const status = String(fd.get('status') || '').trim()

    if (fullName.length < 2) {
      setError('Full name must be at least 2 characters.')
      return
    }
    m.mutate({
      id: empId,
      patch: {
        fullName,
        title: title || null,
        department: department || null,
        location: location || null,
        workEmail: workEmail || null,
        phoneE164: phoneE164 || null,
        status: status || 'active',
      },
    })
  }

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'profile', label: 'Profile' },
    { key: 'tasks', label: 'Tasks', count: stats.totalTasks },
    { key: 'timeOff', label: 'Time off', count: stats.timeOff },
    { key: 'activity', label: 'Activity', count: activity.length },
  ]

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div>
        <button type="button" className="btn btnGhost" onClick={() => navigate(-1)} style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px' }} aria-label="Go back">
          <span aria-hidden>←</span>
          <span>Back</span>
        </button>
      </div>

      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Employee profile</div>
            <div className="pageHeaderCardSub">Dashboard, profile, tasks, time off, and activity for the selected employee.</div>
            {employee ? (
              <div className="pageHeaderCardMeta">
                <span className="pageHeaderCardTag">{employee.full_name}</span>
                <span className="pageHeaderCardTag">{titleCase(employee.status)}</span>
                {employee.department ? <span className="pageHeaderCardTag">{employee.department}</span> : null}
              </div>
            ) : null}
          </div>
          <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to="/app/hr/employees">
            Back to directory
          </Link>
        </div>
      </div>

      {q.isLoading ? <div className="card" style={{ padding: 18, color: 'var(--text2)' }}>Loading employee profile…</div> : null}
      {q.isError ? <div className="alert alertError">Failed to load employee.</div> : null}
      {error ? <div className="alert alertError">{error}</div> : null}

      {employee ? (
        <>
          <div className="card" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`btn ${activeTab === tab.key ? 'btnPrimary' : 'btnGhost'}`}
                onClick={() => setActiveTab(tab.key)}
                style={{ height: 38, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {tab.label}
                {typeof tab.count === 'number' ? <span style={{ opacity: .78 }}>{tab.count}</span> : null}
              </button>
            ))}
          </div>

          {activeTab === 'dashboard' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <MetricCard label="Total tasks" value={stats.totalTasks} />
                <MetricCard label="Open tasks" value={stats.open} />
                <MetricCard label="Completed" value={stats.completed} />
                <MetricCard label="Overdue" value={stats.overdue} />
                <MetricCard label="Time off" value={stats.timeOff} />
              </div>
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ margin: 0 }}>Profile summary</h3>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <MetricCard label="Title" value={employee.title} />
                  <MetricCard label="Department" value={employee.department} />
                  <MetricCard label="Manager" value={employee.manager_name} />
                  <MetricCard label="Hire date" value={fmtDate(employee.hire_date)} />
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'profile' ? (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Profile details</h2>
                  <div style={{ color: 'var(--text2)', marginTop: 4 }}>Manage employee details and status.</div>
                </div>
              </div>
              <form onSubmit={onSave} className="form" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end' }}>
                <label className="label" style={{ gridColumn: '1 / -1' }}>Full name<input className="input" name="fullName" defaultValue={employee.full_name || ''} /></label>
                <label className="label">Status<select className="input" name="status" defaultValue={employee.status || 'active'} style={{ height: 44 }}><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option><option value="terminated">Terminated</option></select></label>
                <label className="label">Title<input className="input" name="title" defaultValue={employee.title || ''} /></label>
                <label className="label">Department<input className="input" name="department" defaultValue={employee.department || ''} /></label>
                <label className="label">Location<input className="input" name="location" defaultValue={employee.location || ''} /></label>
                <label className="label">Work email<input className="input" name="workEmail" defaultValue={employee.work_email || employee.linked_user_email || ''} /></label>
                <label className="label">Phone (E.164)<input className="input" name="phoneE164" defaultValue={employee.phone_e164 || ''} placeholder="+9665…" /></label>
                <button className="btn btnPrimary" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save changes'}</button>
              </form>
            </div>
          ) : null}

          {activeTab === 'tasks' ? (
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ margin: 0 }}>Assigned tasks</h3>
              {tasksQ.isLoading ? <div style={{ marginTop: 12, color: 'var(--text2)' }}>Loading tasks…</div> : null}
              {!tasksQ.isLoading && tasks.length === 0 ? <SectionEmpty title="No tasks found" body="No assigned tasks were found for this employee profile." /> : null}
              {tasks.length ? <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>{tasks.map((task) => <div key={task.id} className="card" style={{ padding: 12, display: 'grid', gap: 4 }}><strong>{task.title}</strong><div style={{ color: 'var(--text2)', display: 'flex', gap: 8, flexWrap: 'wrap' }}><span>{titleCase(task.status)}</span><span>{titleCase(task.priority)}</span><span>Due {fmtDate(task.due_date)}</span></div></div>)}</div> : null}
            </div>
          ) : null}

          {activeTab === 'timeOff' ? (
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ margin: 0 }}>Time off</h3>
              {timeOffQ.isLoading ? <div style={{ marginTop: 12, color: 'var(--text2)' }}>Loading time off…</div> : null}
              {!timeOffQ.isLoading && timeOff.length === 0 ? <SectionEmpty title="No time off records" body="No time off requests were found for this employee." /> : null}
              {timeOff.length ? <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>{timeOff.map((request) => <div key={request.id} className="card" style={{ padding: 12, display: 'grid', gap: 4 }}><strong>{fmtDate(request.start_date)} → {fmtDate(request.end_date)}</strong><div style={{ color: 'var(--text2)' }}>{titleCase(request.status)}{request.reason ? ` • ${request.reason}` : ''}</div></div>)}</div> : null}
            </div>
          ) : null}

          {activeTab === 'activity' ? (
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ margin: 0 }}>Activity</h3>
              {activityQ.isLoading ? <div style={{ marginTop: 12, color: 'var(--text2)' }}>Loading activity…</div> : null}
              {!activityQ.isLoading && activity.length === 0 ? <SectionEmpty title="No activity found" body="No activity records were found for the linked user account." /> : null}
              {activity.length ? <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>{activity.map((item, index) => <div key={item.id || index} className="card" style={{ padding: 12, display: 'grid', gap: 4 }}><strong>{titleCase(item.activity_type || item.type || item.action || item.event_type)}</strong><div style={{ color: 'var(--text2)' }}>{item.note || 'Activity recorded'} • {fmtDate(item.created_at)}</div></div>)}</div> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
