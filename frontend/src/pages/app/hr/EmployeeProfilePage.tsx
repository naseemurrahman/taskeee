import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Employee = {
  id: string
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

async function fetchEmployee(id: string) {
  const data = await apiFetch<{ employee: Employee }>(`/api/v1/hris/employees/${encodeURIComponent(id)}`)
  return data.employee
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

async function updateEmployee(input: { id: string; patch: EmployeePatch }) {
  return await apiFetch<{ employee: Employee }>(`/api/v1/hris/employees/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    json: input.patch,
  })
}

export function EmployeeProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const empId = id || ''
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['hris', 'employee', empId], queryFn: () => fetchEmployee(empId), enabled: !!empId })
  const employee = q.data

  const [error, setError] = useState<string | null>(null)

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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <button
          type="button"
          className="btn btnGhost"
          onClick={() => navigate(-1)}
          style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px' }}
          aria-label="Go back"
        >
          <span aria-hidden>←</span>
          <span>Back</span>
        </button>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Employee profile</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Manage employee details and status.</div>
          </div>
          <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to="/app/hr/employees">
            Back to directory
          </Link>
        </div>

        {q.isLoading ? <div style={{ color: 'var(--text2)', marginTop: 12 }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load employee.</div> : null}
        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}

        {employee ? (
          <form onSubmit={onSave} className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Full name
              <input className="input" name="fullName" defaultValue={employee.full_name || ''} />
            </label>
            <label className="label">
              Status
              <select className="input" name="status" defaultValue={employee.status || 'active'} style={{ height: 44 }}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on_leave">On leave</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label className="label">
              Title
              <input className="input" name="title" defaultValue={employee.title || ''} />
            </label>
            <label className="label">
              Department
              <input className="input" name="department" defaultValue={employee.department || ''} />
            </label>
            <label className="label">
              Location
              <input className="input" name="location" defaultValue={employee.location || ''} />
            </label>
            <label className="label">
              Work email
              <input className="input" name="workEmail" defaultValue={employee.work_email || ''} />
            </label>
            <label className="label">
              Phone (E.164)
              <input className="input" name="phoneE164" defaultValue={employee.phone_e164 || ''} placeholder="+9665…" />
            </label>

            <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
              {m.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : null}
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 8 }}>Quick links</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to="/app/hr/time-off">
            Time off
          </Link>
        </div>
      </div>
    </div>
  )
}
