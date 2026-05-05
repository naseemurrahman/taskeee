import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { Modal } from '../Modal'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import { getUser } from '../../state/auth'
import { useToast } from '../ui/ToastSystem'

type Project = { id: string; name: string; color?: string | null }
type UserRow = { id: string; email: string; name?: string | null; full_name?: string | null; role: string; department?: string | null }
type WorkloadRow = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }
type CreateTaskInput = { title: string; description?: string; assignedTo: string; categoryId: string; priority: string; dueDate: string; department?: string }
type FieldErrors = Partial<Record<'title' | 'project' | 'priority' | 'assignedTo' | 'dueDate', string>>

async function fetchProjects(): Promise<Project[]> {
  try { const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects'); return d.projects || [] } catch { return [] }
}
async function fetchWorkload(): Promise<WorkloadRow[]> {
  try { const d = await apiFetch<{ employees: WorkloadRow[] }>('/api/v1/analytics/workload?days=30'); return d.employees || [] } catch { return [] }
}
async function fetchAllUsers(): Promise<UserRow[]> {
  const normalize = (rows: UserRow[]) => { const seen = new Set<string>(); return rows.filter(r => r?.id && !seen.has(r.id) && seen.add(r.id)) }
  const enrichDepts = async (users: UserRow[]) => {
    if (!users.length) return users
    try {
      const d = await apiFetch<{ employees: Array<{ user_id?: string | null; work_email?: string | null; department?: string | null }> }>('/api/v1/hris/employees?page=1&limit=200')
      const byUserId = new Map<string, string>(); const byEmail = new Map<string, string>()
      for (const e of d.employees || []) { const dep = String(e.department || '').trim(); if (!dep) continue; if (e.user_id) byUserId.set(e.user_id, dep); if (e.work_email) byEmail.set(e.work_email.toLowerCase(), dep) }
      return users.map(u => ({ ...u, department: u.department?.trim() || byUserId.get(u.id) || byEmail.get((u.email || '').toLowerCase()) || null }))
    } catch { return users }
  }
  try { const d = await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users'); if (d.users?.length) return await enrichDepts(normalize(d.users)) } catch {}
  try { const d = await apiFetch<{ users: UserRow[] }>('/api/v1/users?page=1&limit=200'); return await enrichDepts(normalize(d.users || [])) } catch { return [] }
}

function roleRank(r?: string) { const ranks: Record<string, number> = { admin: 100, director: 90, hr: 80, manager: 70, supervisor: 60 }; return ranks[r || ''] ?? 0 }
const PRIORITIES = [
  { value: 'low', label: 'Low', color: '#38bdf8', description: 'Nice to have' },
  { value: 'medium', label: 'Medium', color: '#8B5CF6', description: 'Normal priority' },
  { value: 'high', label: 'High', color: '#f97316', description: 'Complete soon' },
  { value: 'critical', label: 'Critical', color: '#ef4444', description: 'Urgent' },
]
function workloadTone(openTasks: number, average: number) {
  if (openTasks <= Math.max(1, average * 0.65)) return { label: 'Best capacity', color: '#22c55e', bg: 'rgba(34,197,94,.10)' }
  if (openTasks <= Math.max(3, average * 1.15)) return { label: 'Balanced', color: '#8B5CF6', bg: 'rgba(139,92,246,.10)' }
  return { label: 'High load', color: '#f97316', bg: 'rgba(249,115,22,.10)' }
}

export function CreateTaskModal(props: { open: boolean; onClose: () => void; defaultProjectId?: string | null; initialDueDate?: string | null }) {
  const qc = useQueryClient(); const me = getUser(); const canAssign = roleRank(me?.role) >= 60
  const { success: toastSuccess, error: toastError } = useToast()
  const [dept, setDept] = useState(''); const [assignedTo, setAssignedTo] = useState(''); const [priority, setPriority] = useState('medium'); const [projectId, setProjectId] = useState(props.defaultProjectId || ''); const [error, setError] = useState<string | null>(null); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const projectsQ = useQuery({ queryKey: ['modal-projects'], queryFn: fetchProjects, enabled: props.open, staleTime: 60_000 })
  const usersQ = useQuery({ queryKey: ['modal-users'], queryFn: fetchAllUsers, enabled: props.open && canAssign, staleTime: 60_000 })
  const workloadQ = useQuery({ queryKey: ['modal-workload'], queryFn: fetchWorkload, enabled: props.open && canAssign, staleTime: 45_000 })
  const allUsers = usersQ.data || []; const projects = projectsQ.data || []; const workloadRows = workloadQ.data || []
  const workloadById = useMemo(() => new Map(workloadRows.map(w => [w.employee_id, w])), [workloadRows])
  const averageOpenTasks = workloadRows.length ? workloadRows.reduce((sum, w) => sum + Number(w.open_tasks || 0), 0) / workloadRows.length : 0
  const departments = [...new Set(allUsers.filter(u => u.department?.trim()).map(u => u.department as string))].sort(); const hasDepts = departments.length > 0; const filteredAssignees = dept ? allUsers.filter(u => u.department?.trim() === dept) : allUsers

  const capacityGuidance = useMemo(() => filteredAssignees.map(user => {
    const workload = workloadById.get(user.id); const openTasks = Number(workload?.open_tasks || 0); const totalTasks = Number(workload?.total_tasks || 0); const tone = workloadTone(openTasks, averageOpenTasks)
    return { id: user.id, name: user.full_name || user.name || user.email, department: user.department, role: user.role, openTasks, totalTasks, tone }
  }).sort((a, b) => a.openTasks - b.openTasks || a.name.localeCompare(b.name)).slice(0, 5), [averageOpenTasks, filteredAssignees, workloadById])

  const selectedGuidance = capacityGuidance.find(c => c.id === assignedTo) || (assignedTo ? (() => {
    const user = allUsers.find(u => u.id === assignedTo); if (!user) return null
    const workload = workloadById.get(user.id); const openTasks = Number(workload?.open_tasks || 0); const tone = workloadTone(openTasks, averageOpenTasks)
    return { id: user.id, name: user.full_name || user.name || user.email, department: user.department, role: user.role, openTasks, totalTasks: Number(workload?.total_tasks || 0), tone }
  })() : null)

  function clearField(name: keyof FieldErrors) { setFieldErrors(prev => ({ ...prev, [name]: undefined })) }
  function handleClose() { setDept(''); setAssignedTo(''); setPriority('medium'); setProjectId(props.defaultProjectId || ''); setError(null); setFieldErrors({}); props.onClose() }
  const m = useMutation({
    mutationFn: (input: CreateTaskInput) => apiFetch<{ task: unknown }>('/api/v1/tasks/create-simple', { method: 'POST', json: input }),
    onSuccess: () => {
      setError(null); setFieldErrors({})
      qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['performance'] }); qc.invalidateQueries({ queryKey: ['modal-workload'] })
      toastSuccess('Task created', 'The task has been assigned and is ready.')
      handleClose()
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : String(err) || 'Failed to create task. Please try again.'
      console.error('[CreateTask] Error:', msg, err)
      setError(msg)
      toastError('Create failed', msg)
    }
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); e.stopPropagation(); setError(null)
    const fd = new FormData(e.currentTarget); const title = String(fd.get('title') || '').trim(); const description = String(fd.get('description') || '').trim(); const dueDate = String(fd.get('dueDate') || '').trim()
    const nextErrors: FieldErrors = {}
    if (!title || title.length < 2) nextErrors.title = 'Enter a task title with at least 2 characters.'
    if (!projectId) nextErrors.project = 'Choose the project this task belongs to.'
    if (!priority) nextErrors.priority = 'Choose a priority.'
    if (!assignedTo) nextErrors.assignedTo = 'Select the employee responsible for this task.'
    if (!dueDate) nextErrors.dueDate = 'Select a due date.'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) { setError('Please fix the highlighted fields.'); return }
    m.mutate({ title, description: description || undefined, assignedTo, categoryId: projectId, priority, dueDate, department: dept || undefined })
  }

  return (
    <Modal title="Create Task" subtitle="Assign work with capacity guidance and clear required fields." open={props.open} onClose={handleClose} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>
      {!canAssign && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>Your role ({me?.role}) cannot assign tasks. Only supervisors, managers, HR, and admins can create tasks.</div>}
      {canAssign && !usersQ.isLoading && allUsers.length === 0 && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 6, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>No team members found. Go to <strong>HR → Employees</strong> to add employees before creating tasks.</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.28)', color: '#ef4444', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>{error}</div>}
      <form aria-label="Create task form" onSubmit={onSubmit} className="createTaskForm">
        <div className="requiredFieldHint">Required: title, project, priority, assignee, and due date. Description is optional.</div>
        <div className="createTaskSection">
          <div className="createTaskSectionTitle">Task details</div>
          <div className={fieldErrors.title ? 'createTaskFieldInvalid' : ''}><Input label="Task Title" required name="title" autoFocus placeholder="e.g. Prepare onboarding plan for new joiner" onChange={() => clearField('title')} icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>} />{fieldErrors.title && <div className="createTaskFieldError">{fieldErrors.title}</div>}</div>
          <div className="createTaskGrid2">
            <div className={fieldErrors.project ? 'createTaskFieldInvalid' : ''}><Select label="Project" required value={projectId} onChange={v => { setProjectId(v); clearField('project') }} options={[{ value: '', label: projectsQ.isLoading ? 'Loading projects…' : 'Select project…', disabled: true }, ...projects.map(p => ({ value: p.id, label: p.name, color: p.color || undefined }))]} />{fieldErrors.project && <div className="createTaskFieldError">{fieldErrors.project}</div>}</div>
            <div className={fieldErrors.priority ? 'createTaskFieldInvalid' : ''}><Select label="Priority" required value={priority} onChange={v => { setPriority(v); clearField('priority') }} options={PRIORITIES.map(p => ({ value: p.value, label: p.label, description: p.description, color: p.color }))} />{fieldErrors.priority && <div className="createTaskFieldError">{fieldErrors.priority}</div>}</div>
          </div>
        </div>
        <div className="createTaskSection">
          <div className="createTaskSectionTitle">Assignment</div>
          <div className="createTaskGrid2" style={{ gridTemplateColumns: hasDepts ? '1fr 1fr' : '1fr' }}>
            {hasDepts && <div><Select label="Department" value={dept} onChange={v => { setDept(v); setAssignedTo(''); clearField('assignedTo') }} options={[{ value: '', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} searchable={departments.length > 5} />{dept && <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700, marginTop: 3, paddingLeft: 2 }}>↓ {filteredAssignees.length} employee{filteredAssignees.length !== 1 ? 's' : ''} in {dept}</div>}</div>}
            <div className={fieldErrors.assignedTo ? 'createTaskFieldInvalid' : ''}><Select label="Assign To" required value={assignedTo} onChange={v => { setAssignedTo(v); clearField('assignedTo') }} searchable options={[{ value: '', label: usersQ.isLoading ? 'Loading employees…' : allUsers.length === 0 ? 'No team members — add employees first' : `Select employee… (${filteredAssignees.length})`, disabled: true }, ...filteredAssignees.map(u => { const workload = workloadById.get(u.id); const openTasks = Number(workload?.open_tasks || 0); return { value: u.id, label: u.full_name || u.name || u.email, description: [u.department, u.role, `${openTasks} open`].filter(Boolean).join(' · ') } })]} />{fieldErrors.assignedTo && <div className="createTaskFieldError">{fieldErrors.assignedTo}</div>}</div>
          </div>
          {canAssign && <div className="capacityGuideCard"><div className="capacityGuideHeader"><div><div className="capacityGuideTitle">Capacity guidance</div><div className="capacityGuideSub">Suggested by current open workload. Manager keeps final assignment control.</div></div><span className="capacityGuideAvg">Avg {averageOpenTasks.toFixed(1)} open</span></div>{workloadQ.isLoading ? <div className="capacityGuideEmpty">Loading workload…</div> : capacityGuidance.length === 0 ? <div className="capacityGuideEmpty">No workload data available yet.</div> : <div className="capacityGuideList">{capacityGuidance.map(candidate => { const selected = candidate.id === assignedTo; return <button key={candidate.id} type="button" className={`capacityGuideItem ${selected ? 'capacityGuideItemSelected' : ''}`} onClick={() => { setAssignedTo(candidate.id); clearField('assignedTo') }}><div style={{ minWidth: 0 }}><div className="capacityGuideName">{candidate.name}</div><div className="capacityGuideMeta">{candidate.department || candidate.role || 'Team member'} · {candidate.totalTasks} total tasks</div></div><div className="capacityGuideStats"><span className="capacityGuideLoad">{candidate.openTasks} open</span><span className="capacityGuideTone" style={{ color: candidate.tone.color, background: candidate.tone.bg }}>{candidate.tone.label}</span></div></button> })}</div>}{selectedGuidance && <div className="capacityGuideSelected">Selected: <strong>{selectedGuidance.name}</strong> · {selectedGuidance.openTasks} open tasks · {selectedGuidance.tone.label}</div>}</div>}
        </div>
        <div className="createTaskSection">
          <div className="createTaskSectionTitle">Schedule and notes</div>
          <div className={fieldErrors.dueDate ? 'createTaskFieldInvalid' : ''}><Input label="Due Date" required name="dueDate" type="date" defaultValue={props.initialDueDate || ''} onChange={() => clearField('dueDate')} icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />{fieldErrors.dueDate && <div className="createTaskFieldError">{fieldErrors.dueDate}</div>}</div>
          <div><label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Description <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>(optional)</span></label><div className="textareaWrap"><textarea name="description" className="textareaInner" style={{ minHeight: 82 }} placeholder="Context, acceptance criteria, links…" /></div></div>
        </div>
        <div className="createTaskActions"><button type="button" className="btn btnGhost" onClick={handleClose} disabled={m.isPending}>Cancel</button><button type="submit" className="btn btnPrimary" disabled={m.isPending || !canAssign}>{m.isPending ? 'Creating…' : 'Create Task'}</button></div>
      </form>
    </Modal>
  )
}
