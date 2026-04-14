import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { Modal } from '../Modal'
import { getUser } from '../../state/auth'

type Project = { id: string; name: string }
type UserRow = { id: string; user_id?: string | null; email: string; full_name?: string | null; role: string; department?: string | null }

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>(`/api/v1/projects`)
  return d.projects || []
}

async function fetchUsers(department?: string) {
  const qs = new URLSearchParams({ page: '1', limit: '100', ...(department && { department }) })
  const d = await apiFetch<{ employees: UserRow[] }>(`/api/v1/hris/employees?${qs.toString()}`)
  return d.employees || []
}

// Remove fetchDepartments - departments will be derived from employees

type CreateTaskInput = {
  title: string
  description?: string
  assignedTo: string
  categoryId?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  dueDate?: string
  department?: string
}

async function createTask(input: CreateTaskInput) {
  return await apiFetch(`/api/v1/tasks`, { method: 'POST', json: input })
}

function roleRank(role: string | undefined) {
  const r = role || 'employee'
  if (r === 'admin') return 100
  if (r === 'director') return 90
  if (r === 'hr') return 80
  if (r === 'manager') return 70
  if (r === 'supervisor') return 60
  return 50
}

export function CreateTaskModal(props: { open: boolean; onClose: () => void; defaultProjectId?: string | null }) {
  const qc = useQueryClient()
  const me = getUser()
  const canAssign = roleRank(me?.role) >= 60

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, enabled: props.open })
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')
  const usersQ = useQuery({ 
    queryKey: ['team', 'users', selectedDepartment], 
    queryFn: () => fetchUsers(selectedDepartment), 
    enabled: props.open && canAssign 
  })

  // Reset assignee when department changes
  const handleDepartmentChange = (dept: string) => {
    setSelectedDepartment(dept)
    // Reset assignee selection when department changes to avoid mismatched assignments
    const assigneeSelect = document.querySelector('select[name="assignedTo"]') as HTMLSelectElement
    if (assigneeSelect) {
      assigneeSelect.value = ''
    }
    
    // Force React Query to refetch users when department changes
    // The queryKey includes the department, so we need to invalidate with the new dept
    qc.invalidateQueries({ queryKey: ['team', 'users', dept] })
  }

  const [error, setError] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      setError(null)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] }),
        qc.invalidateQueries({ queryKey: ['jeczone', 'tasks'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
        qc.invalidateQueries({ queryKey: ['analytics', 'deadlines'] }),
        qc.invalidateQueries({ queryKey: ['performance', 'summary'] }),
        qc.invalidateQueries({ queryKey: ['analytics', 'summary'] }),
      ])
      props.onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create task.')
    },
  })

  const projects = projectsQ.data || []
  const assignees = usersQ.data || []

  // Derive departments from employees data
  const departments = assignees.length > 0 
    ? [...new Set(assignees.filter(u => u.department && u.department.trim() !== '').map(u => u.department))]
    : []

  // Debug: Check assignees data
  console.log('Assignees loaded:', assignees.map(a => ({ 
    id: a.id, 
    user_id: a.user_id, 
    name: a.full_name,
    department: a.department,
    hasUserId: !!a.user_id 
  })))
  console.log('Selected department:', selectedDepartment)
  console.log('Departments list:', departments)

  // Filter assignees by selected department
  // When no department selected (empty string), show all assignees
  const filteredAssignees = selectedDepartment && selectedDepartment.trim() !== ''
    ? assignees.filter(u => u.department && u.department.trim() === selectedDepartment.trim())
    : assignees

  
  const defaultAssignee = useMemo(() => {
    if (filteredAssignees.length) return filteredAssignees[0].user_id || filteredAssignees[0].id
    return ''
  }, [filteredAssignees, selectedDepartment])

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const title = String(fd.get('title') || '').trim()
    const description = String(fd.get('description') || '').trim()
    const assignedTo = String(fd.get('assignedTo') || '').trim()
    const categoryId = String(fd.get('categoryId') || '').trim()
    const priority = String(fd.get('priority') || 'medium') as CreateTaskInput['priority']
    const dueDate = String(fd.get('dueDate') || '').trim()
    const department = String(fd.get('department') || '').trim()

    if (title.length < 3) return setError('Title must be at least 3 characters.')

    // Client-side validation: Employee assignment is mandatory
    if (!assignedTo || assignedTo.trim() === '') {
      setError('Please select an employee to assign this task to.')
      return
    }

    m.mutate({
      title,
      description: description || undefined,
      assignedTo: assignedTo || null,
      categoryId: categoryId || undefined,
      priority,
      dueDate: dueDate || undefined,
      department: department || undefined,
    })
  }

  return (
    <Modal
      title="Create task"
      open={props.open}
      onClose={props.onClose}
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} form="createTaskForm" disabled={m.isPending} type="submit">
            {m.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      }
    >
      {error ? <div className="alert alertError" style={{ marginBottom: 12 }}>{error}</div> : null}
      {!canAssign ? <div className="alert alertError" style={{ marginBottom: 12 }}>Your role can’t assign tasks.</div> : null}

      <form id="createTaskForm" onSubmit={onSubmit} className="form" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
        <label className="label" style={{ gridColumn: '1 / -1' }}>
          Title
          <input className="input" name="title" placeholder="e.g. Prepare onboarding plan" />
        </label>

        <label className="label">
          Project
          <select className="input" name="categoryId" defaultValue={props.defaultProjectId || ''} style={{ height: 44 }}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="label">
          Department
          <select 
            className="input" 
            name="department" 
            value={selectedDepartment} 
            onChange={(e) => handleDepartmentChange(e.target.value)}
            style={{ height: 44 }}
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </label>

        <label className="label">
          Priority
          <select className="input" name="priority" defaultValue="medium" style={{ height: 44 }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label className="label">
          Due date
          <input className="input" name="dueDate" type="date" style={{ height: 44 }} />
        </label>

        <label className="label">
          Assign to
          <select className="input" name="assignedTo" defaultValue={defaultAssignee} style={{ height: 44 }}>
            <option value="">Select…</option>
            {filteredAssignees.map((u) => (
              <option key={u.id} value={u.user_id || u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </label>

        <label className="label" style={{ gridColumn: '1 / -1' }}>
          Description (optional)
          <textarea className="input" name="description" style={{ minHeight: 110, paddingTop: 10 }} placeholder="Add context, acceptance criteria, links…" />
        </label>
      </form>
    </Modal>
  )
}

