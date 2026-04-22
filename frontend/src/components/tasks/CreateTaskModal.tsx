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
async function fetchUsers() {
  const d = await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users')
  return d.users || []
}
async function fetchUsersByDepartment(department: string) {
  const d = await apiFetch<{ users: UserRow[] }>(`/api/v1/tasks/assignable-users?department=${encodeURIComponent(department)}`)
  return d.users || []
}
async function fetchDepartments() {
  const d = await apiFetch<{ departments: string[] }>('/api/v1/tasks/departments')
  return d.departments || []
}

function roleRank(r?: string) {
  return { admin: 100, director: 90, hr: 80, manager: 70, supervisor: 60 }[r || ''] ?? 50
}

export function CreateTaskModal(props: { open: boolean; onClose: () => void; defaultProjectId?: string | null }) {
  const qc = useQueryClient()
  const me = getUser()
  const canAssign = roleRank(me?.role) >= 60

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, enabled: props.open })
  const [dept, setDept] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState('medium')
  const [projectId, setProjectId] = useState(props.defaultProjectId || '')
  const [error, setError] = useState<string | null>(null)

  const departmentsQ = useQuery({
    queryKey: ['tasks', 'departments'],
    queryFn: fetchDepartments,
    enabled: props.open && canAssign,
  })
  const usersQ = useQuery({
    queryKey: ['tasks', 'assignable-users', dept || 'all'],
    queryFn: () => (dept ? fetchUsersByDepartment(dept) : fetchUsers()),
    enabled: props.open && canAssign,
  })

  const projects = projectsQ.data || []
  const assignees = usersQ.data || []
  const departments = departmentsQ.data || []

  const m = useMutation({
    mutationFn: (input: CreateTaskInput) => apiFetch('/api/v1/tasks', { method: 'POST', json: input }),
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] })
      await qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      await qc.invalidateQueries({ queryKey: ['performance', 'summary'] })
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
    if (!assignedTo) return setError('Please select an employee to assign this task to.')

    m.mutate({
      title, description: description || undefined,
      assignedTo,
      categoryId: projectId || undefined,
      priority,
      dueDate: dueDate || undefined,
      department: dept || undefined,
    })
  }

  const PRIORITIES = [
    { value: 'low', label: 'Low', color: '#38bdf8', description: 'Nice to have, no rush' },
    { value: 'medium', label: 'Medium', color: '#8B5CF6', description: 'Normal priority' },
    { value: 'high', label: 'High', color: '#f97316', description: 'Important, complete soon' },
    { value: 'critical', label: 'Critical', color: '#ef4444', description: 'Urgent, drop everything' },
  ]

  return (
    <Modal
      title="Create Task"
      subtitle="Assign work to a team member"
      open={props.open}
      onClose={props.onClose}
      bodyClassName="createTaskModalBody"
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      }
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btnGhost" style={{ height: 44, padding: '0 20px' }} onClick={props.onClose} type="button">
            Cancel
          </button>
          <button className="btn btnPrimary" style={{ height: 44, padding: '0 24px' }} form="createTaskForm" disabled={m.isPending} type="submit">
            {m.isPending ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      }
    >
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, marginBottom: 16,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}
      {!canAssign && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
          Your role cannot assign tasks. Contact an admin.
        </div>
      )}

      <form id="createTaskForm" onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
        <Input
          label="Task Title" required name="title"
          placeholder="e.g. Prepare onboarding plan for new joiner"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Select
            label="Department"
            value={dept}
            onChange={v => { setDept(v); setAssignedTo('') }}
            options={[
              { value: '', label: 'All departments' },
              ...departments.length
                ? departments.map(d => ({ value: d, label: d }))
                : [{ value: '__none__', label: 'No departments found', disabled: true }],
            ]}
            searchable={departments.length > 5}
          />
          <Select
            label="Assign to" required
            value={assignedTo}
            onChange={setAssignedTo}
            options={[
              { value: '', label: 'Select employee…' },
              ...assignees.map(u => ({
                value: u.id,
                label: u.full_name || u.name || u.email,
                description: u.department || u.role,
              })),
            ]}
            searchable
            error={!assignedTo && m.isError ? 'Required' : undefined}
          />
        </div>

        <Input
          label="Due Date" name="dueDate" type="date"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
        />

        <div className="inputV3Wrap">
          <label className="selectV3Label">Description <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: 11 }}>(optional)</span></label>
          <div className="inputV3Field" style={{ height: 'auto' }}>
            <textarea
              name="description"
              className="inputV3Native"
              style={{ height: 90, paddingTop: 12, paddingBottom: 12, resize: 'vertical' }}
              placeholder="Context, acceptance criteria, links…"
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
