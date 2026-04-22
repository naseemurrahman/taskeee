import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { Modal } from '../Modal'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import { getUser } from '../../state/auth'

type Project = { id: string; name: string; color?: string | null }
type UserRow = { id: string; email: string; name?: string | null; full_name?: string | null; role: string; department?: string | null }
type CreateTaskInput = {
  title: string; description?: string; assignedTo: string
  categoryId?: string; priority?: string; dueDate?: string; department?: string
}

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
  return d.projects || []
}

// Always fetch all assignable users — department filtering done client-side
async function fetchAllUsers(): Promise<UserRow[]> {
  const normalize = (rows: UserRow[]) => {
    const seen = new Set<string>()
    const out: UserRow[] = []
    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
    return out
  }

  const enrichWithEmployeeDepartments = async (users: UserRow[]) => {
    if (!users.length) return users
    try {
      const d = await apiFetch<{ employees: Array<{ user_id?: string | null; work_email?: string | null; department?: string | null }> }>(
        '/api/v1/hris/employees?page=1&limit=200'
      )
      const emps = d.employees || []
      if (!emps.length) return users
      const byUserId = new Map<string, string>()
      const byEmail = new Map<string, string>()
      for (const e of emps) {
        const dep = String(e.department || '').trim()
        if (!dep) continue
        if (e.user_id) byUserId.set(e.user_id, dep)
        if (e.work_email) byEmail.set(String(e.work_email).toLowerCase(), dep)
      }
      return users.map((u) => ({
        ...u,
        department: u.department?.trim() || byUserId.get(u.id) || byEmail.get(String(u.email || '').toLowerCase()) || null,
      }))
    } catch {
      return users
    }
  }

  try {
    const d = await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users')
    if (d.users && d.users.length > 0) {
      return await enrichWithEmployeeDepartments(normalize(d.users))
    }
  } catch { /* fall through */ }
  // Fallback to workspace accounts
  try {
    const d = await apiFetch<{ users: UserRow[] }>('/api/v1/users?page=1&limit=200')
    return await enrichWithEmployeeDepartments(normalize(d.users || []))
  } catch { return [] }
}

function roleRank(r?: string) {
  return { admin: 100, director: 90, hr: 80, manager: 70, supervisor: 60 }[r || ''] ?? 50
}

export function CreateTaskModal(props: { open: boolean; onClose: () => void; defaultProjectId?: string | null }) {
  const qc = useQueryClient()
  const me = getUser()
  const canAssign = roleRank(me?.role) >= 60

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, enabled: props.open })
  const usersQ = useQuery({
    queryKey: ['tasks', 'all-users'],
    queryFn: fetchAllUsers,
    enabled: props.open && canAssign,
  })

  const [dept, setDept] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState('medium')
  const [projectId, setProjectId] = useState(props.defaultProjectId || '')
  const [error, setError] = useState<string | null>(null)

  const allUsers = usersQ.data || []
  const projects = projectsQ.data || []

  // Derive departments from users who actually have one set
  const departments = [...new Set(allUsers.filter(u => u.department?.trim()).map(u => u.department as string))].sort()
  const hasDepts = departments.length > 0

  // Filter assignees by selected department (client-side)
  const filteredAssignees = dept ? allUsers.filter(u => u.department?.trim() === dept) : allUsers

  const m = useMutation({
    mutationFn: (input: CreateTaskInput) => apiFetch('/api/v1/tasks', { method: 'POST', json: input }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      void qc.invalidateQueries({ queryKey: ['performance', 'summary'] })
      props.onClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create task.')
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const title = String(fd.get('title') || '').trim()
    const description = String(fd.get('description') || '').trim()
    const dueDate = String(fd.get('dueDate') || '').trim()

    if (title.length < 3) return setError('Title must be at least 3 characters.')
    if (!assignedTo) return setError('Please select who to assign this task to.')

    m.mutate({
      title,
      description: description || undefined,
      assignedTo,
      categoryId: projectId || undefined,
      priority,
      dueDate: dueDate || undefined,
      department: dept || undefined,
    })
  }

  const PRIORITIES = [
    { value: 'low',      label: 'Low',      color: '#38bdf8', description: 'Nice to have, no rush' },
    { value: 'medium',   label: 'Medium',   color: '#8B5CF6', description: 'Normal priority' },
    { value: 'high',     label: 'High',     color: '#f97316', description: 'Important, complete soon' },
    { value: 'critical', label: 'Critical', color: '#ef4444', description: 'Urgent, drop everything' },
  ]

  return (
    <Modal
      title="Create Task"
      subtitle="Assign work to a team member"
      open={props.open}
      onClose={props.onClose}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      }
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btnGhost" onClick={props.onClose} type="button">Cancel</button>
          <button className="btn btnPrimary" form="createTaskForm" disabled={m.isPending} type="submit">
            {m.isPending ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      }
    >
      {error && (
        <div style={{
          padding: '9px 14px', borderRadius: 10, marginBottom: 12,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {!canAssign && (
        <div style={{ padding: '9px 14px', borderRadius: 10, marginBottom: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
          Your role cannot assign tasks. Contact an admin.
        </div>
      )}

      <form id="createTaskForm" onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>

        {/* Title */}
        <Input
          label="Task Title" required name="title"
          placeholder="e.g. Prepare onboarding plan for new joiner"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        />

        {/* Project + Priority */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select
            label="Project"
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: '', label: 'No project' },
              ...projects.map(p => ({ value: p.id, label: p.name, color: p.color || undefined })),
            ]}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={PRIORITIES.map(p => ({ value: p.value, label: p.label, description: p.description, color: p.color }))}
          />
        </div>

        {/* Department (only if users have departments) + Assign To */}
        <div style={{ display: 'grid', gridTemplateColumns: hasDepts ? '1fr 1fr' : '1fr', gap: 12 }}>
          {hasDepts && (
            <div>
              <Select
                label="Filter by Department"
                value={dept}
                onChange={v => { setDept(v); setAssignedTo('') }}
                options={[
                  { value: '', label: 'All departments' },
                  ...departments.map(d => ({ value: d, label: d })),
                ]}
                searchable={departments.length > 6}
              />
              {dept && (
                <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700, marginTop: 3, paddingLeft: 2 }}>
                  ↓ {filteredAssignees.length} employee{filteredAssignees.length !== 1 ? 's' : ''} in {dept}
                </div>
              )}
            </div>
          )}
          <Select
            label="Assign To" required
            value={assignedTo}
            onChange={setAssignedTo}
            preferOpenUp
            options={[
              { value: '', label: usersQ.isLoading ? 'Loading…' : 'Select employee…' },
              ...filteredAssignees.map(u => ({
                value: u.id,
                label: u.full_name || u.name || u.email,
                description: [u.department, u.role].filter(Boolean).join(' · '),
              })),
            ]}
            searchable
            error={!assignedTo && m.isError ? 'Required' : undefined}
          />
        </div>

        {/* Due Date */}
        <Input
          label="Due Date" name="dueDate" type="date"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
        />

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Description <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: 11, color: 'var(--muted)' }}>(optional)</span>
          </label>
          <div className="textareaWrap">
            <textarea name="description" className="textareaInner" style={{ minHeight: 76 }} placeholder="Context, acceptance criteria, links…" />
          </div>
        </div>

      </form>
    </Modal>
  )
}
