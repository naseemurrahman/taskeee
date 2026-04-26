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

async function fetchProjects(): Promise<Project[]> {
  try {
    const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
    return d.projects || []
  } catch { return [] }
}

async function fetchAllUsers(): Promise<UserRow[]> {
  const normalize = (rows: UserRow[]) => {
    const seen = new Set<string>()
    return rows.filter(r => r?.id && !seen.has(r.id) && seen.add(r.id))
  }

  const enrichDepts = async (users: UserRow[]) => {
    if (!users.length) return users
    try {
      const d = await apiFetch<{ employees: Array<{ user_id?: string | null; work_email?: string | null; department?: string | null }> }>(
        '/api/v1/hris/employees?page=1&limit=200'
      )
      const byUserId = new Map<string, string>()
      const byEmail = new Map<string, string>()
      for (const e of d.employees || []) {
        const dep = String(e.department || '').trim()
        if (!dep) continue
        if (e.user_id) byUserId.set(e.user_id, dep)
        if (e.work_email) byEmail.set(e.work_email.toLowerCase(), dep)
      }
      return users.map(u => ({
        ...u,
        department: u.department?.trim() || byUserId.get(u.id) || byEmail.get((u.email || '').toLowerCase()) || null,
      }))
    } catch { return users }
  }

  // Try assignable-users endpoint first (role-scoped)
  try {
    const d = await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users')
    if (d.users?.length) return await enrichDepts(normalize(d.users))
  } catch { /* fall through */ }

  // Fallback to all org users
  try {
    const d = await apiFetch<{ users: UserRow[] }>('/api/v1/users?page=1&limit=200')
    return await enrichDepts(normalize(d.users || []))
  } catch { return [] }
}

function roleRank(r?: string) {
  const ranks: Record<string, number> = { admin: 100, director: 90, hr: 80, manager: 70, supervisor: 60 }
  return ranks[r || ''] ?? 0
}

const PRIORITIES = [
  { value: 'low',      label: 'Low',      color: '#38bdf8', description: 'Nice to have' },
  { value: 'medium',   label: 'Medium',   color: '#8B5CF6', description: 'Normal priority' },
  { value: 'high',     label: 'High',     color: '#f97316', description: 'Complete soon' },
  { value: 'critical', label: 'Critical', color: '#ef4444', description: 'Urgent' },
]

export function CreateTaskModal(props: { open: boolean; onClose: () => void; defaultProjectId?: string | null }) {
  const qc = useQueryClient()
  const me = getUser()
  const canAssign = roleRank(me?.role) >= 60 // supervisor, manager, hr, director, admin

  const [dept, setDept] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState('medium')
  const [projectId, setProjectId] = useState(props.defaultProjectId || '')
  const [error, setError] = useState<string | null>(null)

  const projectsQ = useQuery({ queryKey: ['modal-projects'], queryFn: fetchProjects, enabled: props.open, staleTime: 60_000 })
  const usersQ = useQuery({ queryKey: ['modal-users'], queryFn: fetchAllUsers, enabled: props.open && canAssign, staleTime: 60_000 })

  const allUsers = usersQ.data || []
  const projects = projectsQ.data || []
  const departments = [...new Set(allUsers.filter(u => u.department?.trim()).map(u => u.department as string))].sort()
  const hasDepts = departments.length > 0
  const filteredAssignees = dept ? allUsers.filter(u => u.department?.trim() === dept) : allUsers

  function handleClose() {
    // Reset state on close
    setDept(''); setAssignedTo(''); setPriority('medium'); setProjectId(props.defaultProjectId || ''); setError(null)
    props.onClose()
  }

  const m = useMutation({
    mutationFn: (input: CreateTaskInput) => apiFetch<{ task: unknown }>('/api/v1/tasks/create-simple', { method: 'POST', json: input }),
    onSuccess: () => {
      setError(null)
      // Fire-and-forget invalidations so button doesn't get stuck in "Creating…"
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['performance'] })
      handleClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : String(err) || 'Failed to create task. Please try again.')
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    e.stopPropagation()
    setError(null)

    const fd = new FormData(e.currentTarget)
    const title = String(fd.get('title') || '').trim()
    const description = String(fd.get('description') || '').trim()
    const dueDate = String(fd.get('dueDate') || '').trim()

    if (!title || title.length < 2) { setError('Task title is required (at least 2 characters).'); return }
    if (!assignedTo) { setError('Please select an employee to assign this task to.'); return }

    m.mutate({ title, description: description || undefined, assignedTo, categoryId: projectId || undefined, priority, dueDate: dueDate || undefined, department: dept || undefined })
  }

  return (
    <Modal title="Create Task" subtitle="Assign work to a team member" open={props.open} onClose={handleClose}
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
    >
      {/* Role guard */}
      {!canAssign && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
          Your role ({me?.role}) cannot assign tasks. Only supervisors, managers, HR, and admins can create tasks.
        </div>
      )}
      {canAssign && !usersQ.isLoading && allUsers.length === 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 6, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>
          ⚠ No team members found. Go to <strong>HR → Employees</strong> to add employees before creating tasks.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.28)', color: '#ef4444', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
        {/* Title */}
        <Input label="Task Title" required name="title" autoFocus
          placeholder="e.g. Prepare onboarding plan for new joiner"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        />

        {/* Project + Priority */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select label="Project" value={projectId} onChange={setProjectId}
            options={[{ value: '', label: 'No project' }, ...projects.map(p => ({ value: p.id, label: p.name, color: p.color || undefined }))]}
          />
          <Select label="Priority" value={priority} onChange={setPriority}
            options={PRIORITIES.map(p => ({ value: p.value, label: p.label, description: p.description, color: p.color }))}
          />
        </div>

        {/* Department + Assign To */}
        <div style={{ display: 'grid', gridTemplateColumns: hasDepts ? '1fr 1fr' : '1fr', gap: 12 }}>
          {hasDepts && (
            <div>
              <Select label="Department" value={dept} onChange={v => { setDept(v); setAssignedTo('') }}
                options={[{ value: '', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]}
                searchable={departments.length > 5}
              />
              {dept && (
                <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700, marginTop: 3, paddingLeft: 2 }}>
                  ↓ {filteredAssignees.length} employee{filteredAssignees.length !== 1 ? 's' : ''} in {dept}
                </div>
              )}
            </div>
          )}
          <Select
            label="Assign To" required value={assignedTo} onChange={setAssignedTo} searchable
            options={[
              { value: '', label: usersQ.isLoading ? 'Loading employees…' : allUsers.length === 0 ? 'No team members — add employees first' : `Select employee… (${filteredAssignees.length})` },
              ...filteredAssignees.map(u => ({
                value: u.id,
                label: u.full_name || u.name || u.email,
                description: [u.department, u.role].filter(Boolean).join(' · '),
              })),
            ]}
            error={m.isError && !assignedTo ? 'Required' : undefined}
          />
        </div>

        {/* Due Date */}
        <Input label="Due Date" name="dueDate" type="date"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
        />

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Description <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>(optional)</span>
          </label>
          <div className="textareaWrap">
            <textarea name="description" className="textareaInner" style={{ minHeight: 72 }} placeholder="Context, acceptance criteria, links…" />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" className="btn btnGhost" onClick={handleClose} disabled={m.isPending}>Cancel</button>
          <button type="submit" className="btn btnPrimary" disabled={m.isPending || !canAssign}>
            {m.isPending
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 0.8s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                  </svg>
                  Creating…
                </span>
              : 'Create Task'
            }
          </button>
        </div>
      </form>
    </Modal>
  )
}
