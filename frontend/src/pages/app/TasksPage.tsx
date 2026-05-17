import { useMemo, useState, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { IconClipboard } from '../../components/ui/AppIcons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { ChevronRight, MessageCircleMore } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canChangeTaskStatus, isEmployeeRole } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/ToastSystem'
import { buildTaskSignal, signalBadgeClass } from '../../utils/taskSignals'
import { useRealtimeInvalidation } from '../../lib/socket'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { SkeletonRows, ErrorRetry, EmptyState } from '../../components/ui/PageStates'

type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
  project_id?: string | null; project_name?: string | null; project_status?: string | null
  message_count?: number
}

type WorkloadRow = { employee_id: string; open_tasks: number }

const PAGE_SIZE = 50

function fetchTasks(status: string, priority: string, search: string, mine: boolean, page: number) {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) })
  if (status !== 'all') qs.set('status', status)
  if (priority !== 'all') qs.set('priority', priority)
  if (search.trim()) qs.set('search', search.trim())
  if (mine) qs.set('mine', 'true')
  return apiFetch<{ tasks?: Task[]; rows?: Task[]; pagination?: { total: number; pages: number } }>(`/api/v1/tasks?${qs}`)
    .then(d => ({ tasks: (d.tasks || d.rows || []) as Task[], pagination: d.pagination }))
}

async function renameTask(id: string, title: string) {
  return apiFetch(`/api/v1/tasks/${id}/rename`, { method: 'PATCH', json: { title } })
}
async function changeStatus(id: string, status: string) {
  return apiFetch(`/api/v1/tasks/${id}/set-status`, { method: 'POST', json: { status } })
}

function dueStat(iso?: string | null): { label: string; tone: string } {
  if (!iso) return { label: '—', tone: '' }
  const numeric = Number(iso)
  const d = !Number.isNaN(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: '—', tone: '' }
  const yr = d.getFullYear()
  if (yr < 2020 || yr > 2040) return { label: '—', tone: '' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const t = new Date(d); t.setHours(0, 0, 0, 0)
  const days = Math.round((t.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'danger' }
  if (days === 0) return { label: 'Today', tone: 'warn' }
  if (days === 1) return { label: 'Tomorrow', tone: 'warn' }
  if (days < 7) return { label: `In ${days}d`, tone: '' }
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: '' }
}

function hash(s: string) {
  let h = 0; for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}

const PRIORITY_COLOR: Record<string, string> = { low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444', urgent: '#ef4444' }
const STATUS_OPTIONS: Record<string, { label: string; color: string; bg: string }> = {
  pending:          { label: 'Pending',     color: '#e2ab41', bg: 'rgba(226,171,65,0.12)' },
  in_progress:      { label: 'In Progress', color: '#818cf8', bg: 'rgba(99,102,241,0.12)' },
  submitted:        { label: 'Submitted',   color: '#f9e6a2', bg: 'rgba(226,171,65,0.12)' },
  manager_approved: { label: 'Approved',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  manager_rejected: { label: 'Rejected',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  completed:        { label: 'Done',        color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  overdue:          { label: 'Overdue',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  cancelled:        { label: 'Cancelled',   color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  on_hold:          { label: 'On Hold',     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
}
const PROJECT_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  paused: { label: 'Paused', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  completed: { label: 'Completed', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  archived: { label: 'Archived', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  cancelled: { label: 'Cancelled', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

function projectStatus(task: Task) { return String(task.project_status || 'active').toLowerCase() }
function isProjectLocked(task: Task) { return !!task.project_id && projectStatus(task) !== 'active' }
function projectLockMessage(task: Task) {
  const s = projectStatus(task)
  return `Project ${task.project_name || task.project_id || ''} is ${s}; reactivate it before changing task workflow.`
}
function ProjectLifecycleBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  const status = projectStatus(task)
  const meta = PROJECT_STATUS_META[status] || { label: status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  if (!task.project_id && !task.project_name) return null
  return (
    <span title={isProjectLocked(task) ? projectLockMessage(task) : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: compact ? '2px 7px' : '3px 9px', borderRadius: 999, fontSize: compact ? 9 : 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em', color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color }} />
      {meta.label}
    </span>
  )
}
function ProjectCell({ task }: { task: Task }) {
  const projectName = task.project_name || task.category_name
  if (!projectName) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: isProjectLocked(task) ? 'rgba(245,158,11,0.10)' : (task.category_color || '#6366f1') + '18', color: isProjectLocked(task) ? '#f59e0b' : task.category_color || '#818cf8', border: `1px solid ${isProjectLocked(task) ? 'rgba(245,158,11,0.28)' : (task.category_color || '#6366f1') + '28'}` }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: isProjectLocked(task) ? '#f59e0b' : task.category_color || '#818cf8' }} />
        {projectName}
      </span>
      <ProjectLifecycleBadge task={task} compact />
    </div>
  )
}

function getAllowedTransitions(fromStatus: string, role: string): string[] {
  const ALL = ['pending', 'in_progress', 'submitted', 'manager_approved', 'manager_rejected', 'completed', 'overdue', 'cancelled', 'on_hold']
  if (role === 'admin' || role === 'director') return ALL.filter(s => s !== fromStatus)
  const managerLike: Record<string, string[]> = {
    pending: ['in_progress', 'completed', 'cancelled'], overdue: ['in_progress', 'completed', 'pending', 'cancelled'],
    in_progress: ['submitted', 'completed', 'pending', 'cancelled'], submitted: ['manager_approved', 'manager_rejected', 'completed'],
    manager_approved: ['completed'], manager_rejected: ['pending', 'in_progress'], completed: ['pending', 'in_progress'], cancelled: ['pending'], on_hold: ['pending'],
  }
  const employee: Record<string, string[]> = { pending: ['in_progress'], overdue: ['in_progress'], in_progress: ['submitted', 'pending'], submitted: ['in_progress'], manager_approved: ['completed'], manager_rejected: ['in_progress'] }
  return (role === 'employee' || role === 'technician' ? employee : managerLike)[fromStatus] || []
}

const PRIORITY_OPTS = [
  { value: 'all', label: 'All priorities' }, { value: 'low', label: 'Low', color: '#38bdf8' },
  { value: 'medium', label: 'Medium', color: '#8B5CF6' }, { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
]

function InlineTitle({ task, canEdit, onSaved }: { task: Task; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(task.title || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const m = useMutation({ mutationFn: (title: string) => renameTask(task.id, title), onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); onSaved() }, onError: () => { setEditing(false); setVal(task.title || '') } })
  function startEdit(e: MouseEvent) { e.stopPropagation(); setVal(task.title || ''); setEditing(true); setTimeout(() => inputRef.current?.select(), 30) }
  function commit() { const t = val.trim(); if (t && t !== task.title) m.mutate(t); else setEditing(false) }
  if (editing) return <input ref={inputRef} className="inlineEditInput" value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setVal(task.title || '') } }} onClick={e => e.stopPropagation()} style={{ fontSize: 13 }} />
  return <div className="inlineEditWrap"><span style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.title || task.id}</span>{canEdit && <button className="inlineEditBtn" type="button" onClick={startEdit} title="Rename"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>}</div>
}
function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_OPTIONS[status] || { label: status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />{meta.label}</span>
}
function InlineStatus({ task, role, canChange }: { task: Task; role: string; canChange: boolean }) {
  const qc = useQueryClient()
  const { success: toastSuccess } = useToast()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const locked = isProjectLocked(task)
  const transitions = canChange && !locked ? getAllowedTransitions(task.status, role) : []
  const meta = STATUS_OPTIONS[task.status] || { label: task.status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  const m = useMutation({
    mutationFn: (s: string) => changeStatus(task.id, s),
    onSuccess: (_data, newStatus) => { setErrMsg(null); qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); qc.invalidateQueries({ queryKey: ['tasks', 'board'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toastSuccess('Status updated', `Task moved to ${STATUS_OPTIONS[newStatus]?.label || newStatus}`) },
    onError: (err: any) => { const msg = err?.message || 'Failed to update status'; setErrMsg(msg); setTimeout(() => setErrMsg(null), 6000) },
  })
  if (locked) return <div title={projectLockMessage(task)} style={{ display: 'grid', gap: 4 }}><StatusBadge status={task.status} /><span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 800 }}>Project {projectStatus(task)}</span></div>
  if (!canChange || transitions.length === 0) return <StatusBadge status={task.status} />
  const options = [{ value: task.status, label: meta.label }, ...transitions.map(s => ({ value: s, label: STATUS_OPTIONS[s]?.label || s.replace(/_/g, ' ') }))]
  return <div style={{ position: 'relative', display: 'inline-block' }}><select value={task.status} disabled={m.isPending} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); const v = e.target.value; if (v !== task.status) m.mutate(v) }} style={{ padding: '5px 8px 5px 10px', borderRadius: 10, fontSize: 11, fontWeight: 800, fontFamily: 'inherit', background: meta.bg, color: meta.color, border: `1.5px solid ${meta.color}55`, cursor: m.isPending ? 'not-allowed' : 'pointer', outline: 'none', minWidth: 95, maxWidth: 130, opacity: m.isPending ? 0.6 : 1 }}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{errMsg && <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 9999, fontSize: 10, color: '#ef4444', fontWeight: 800, whiteSpace: 'nowrap', background: 'var(--bg1)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)' }}>⚠ {errMsg}</div>}</div>
}

export function TasksPage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const canManage = canCreate
  const isEmployee = isEmployeeRole(me?.role)
  const canChangeStatus = canChangeTaskStatus(me?.role)
  const role = me?.role || 'employee'
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  useRealtimeInvalidation({ tasks: true, dashboard: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>((location.state as any)?.openTaskId || null)
  const [drawerTab, setDrawerTab] = useState<'details' | 'comments'>('details')
  const toggleSelect = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const clearSelected = () => setSelected(new Set())
  const q = useQuery({ queryKey: ['tasks', 'list', status, priority, search, isEmployee, page], queryFn: () => fetchTasks(status, priority, search, isEmployee, page), staleTime: 20_000, refetchInterval: 30_000, refetchOnMount: true, refetchOnWindowFocus: true })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', 'tasks-page'], queryFn: () => apiFetch<{ employees: WorkloadRow[] }>('/api/v1/analytics/workload?days=30').then(d => d.employees || []).catch(() => []), staleTime: 60_000 })
  const loadByUser = useMemo(() => new Map((workloadQ.data || []).map(w => [w.employee_id, Number(w.open_tasks || 0)])), [workloadQ.data])
  const tasks = q.data?.tasks || []
  const pagination = q.data?.pagination
  const selectedTasks = useMemo(() => tasks.filter(t => selected.has(t.id)), [tasks, selected])
  const selectedHasLockedProject = selectedTasks.some(isProjectLocked)
  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0, locked: 0 }
    for (const t of tasks) { c.all++; if (isProjectLocked(t)) c.locked++; if (t.status === 'pending') c.pending++; else if (t.status === 'in_progress') c.in_progress++; else if (t.status === 'completed' || t.status === 'manager_approved') c.completed++; else if (t.status === 'overdue') c.overdue++ }
    return c
  }, [tasks])
  const bulkStatusM = useMutation({
    mutationFn: (newStatus: string) => {
      if (selectedHasLockedProject) throw new Error('One or more selected tasks belong to paused/completed projects.')
      return Promise.all([...selected].map(id => apiFetch(`/api/v1/tasks/${id}/status`, { method: 'PATCH', json: { status: newStatus } })))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toastSuccess('Updated', `${selected.size} tasks updated`); clearSelected() },
    onError: (err: any) => toastError('Bulk update failed', err?.message || 'Could not update selected tasks'),
  })
  const filteredStatusButtons = [
    { k: 'all', label: 'All', count: counts.all }, { k: 'pending', label: 'Pending', count: counts.pending },
    { k: 'in_progress', label: 'In Progress', count: counts.in_progress }, { k: 'completed', label: 'Done', count: counts.completed }, { k: 'overdue', label: 'Overdue', count: counts.overdue },
  ]
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* KPI Cards */}
      <div className="grid4">
        <button type="button" className="miniCard" style={{ '--kpi-color': '#6366f1' } as any} onClick={() => { setStatus('all'); setPage(1) }}>
          <div className="miniLabel">All Tasks</div>
          <div className="miniValue">{counts.all}</div>
        </button>
        <button type="button" className="miniCard" style={{ '--kpi-color': '#eab308' } as any} onClick={() => { setStatus('pending'); setPage(1) }}>
          <div className="miniLabel">Pending</div>
          <div className="miniValue">{counts.pending}</div>
        </button>
        <button type="button" className="miniCard" style={{ '--kpi-color': '#a855f7' } as any} onClick={() => { setStatus('in_progress'); setPage(1) }}>
          <div className="miniLabel">In Progress</div>
          <div className="miniValue">{counts.in_progress}</div>
        </button>
        <button type="button" className="miniCard" style={{ '--kpi-color': '#22c55e' } as any} onClick={() => { setStatus('completed'); setPage(1) }}>
          <div className="miniLabel">Completed</div>
          <div className="miniValue">{counts.completed}</div>
        </button>
        <button type="button" className="miniCard" style={{ '--kpi-color': '#ef4444' } as any} onClick={() => { setStatus('overdue'); setPage(1) }}>
          <div className="miniLabel">Overdue</div>
          <div className="miniValue">{counts.overdue}</div>
        </button>
      </div>

      <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>Tasks{isEmployee && <span className="roleBadge roleBadgeEmployee" style={{ marginLeft: 8 }}>My Tasks</span>}</div><div className="pageHeaderCardSub">{isEmployee ? 'Tasks assigned to you. Project-paused tasks are read-only until the project is reactivated.' : 'Create, assign, and track tasks. Project-paused tasks show a lifecycle badge and locked status controls.'}</div><div className="pageHeaderCardMeta"><span className="pageHeaderCardTag">{tasks.length} total</span>{counts.locked > 0 && <span className="pageHeaderCardTag" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.24)' }}>🔒 {counts.locked} project locked</span>}{counts.overdue > 0 && <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {counts.overdue} overdue</span>}</div></div>{canCreate && <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button">+ Create Task</button>}</div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}><div style={{ flex: '1 1 160px', minWidth: 120 }}><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search tasks…" /></div><div style={{ width: 'min(150px, 100%)', flexShrink: 0 }}><Select value={priority} onChange={v => { setPriority(v); setPage(1) }} options={PRIORITY_OPTS} /></div></div></div>
      {selected.size > 0 && canManage && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: selectedHasLockedProject ? 'rgba(245,158,11,0.10)' : 'rgba(226,171,65,0.10)', border: selectedHasLockedProject ? '1.5px solid rgba(245,158,11,0.30)' : '1.5px solid rgba(226,171,65,0.3)', flexWrap: 'wrap' }}><span style={{ fontWeight: 800, fontSize: 13, color: selectedHasLockedProject ? '#f59e0b' : 'var(--brand)' }}>{selected.size} selected</span>{selectedHasLockedProject && <span style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b' }}>Status changes disabled for paused/completed project tasks.</span>}{(['in_progress','submitted','completed'] as const).map(s => <button key={s} className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 12 }} onClick={() => bulkStatusM.mutate(s)} disabled={bulkStatusM.isPending || selectedHasLockedProject}>→ {s.replace(/_/g,' ')}</button>)}<button onClick={clearSelected} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Clear</button></div>}
      <div className="chartV3" style={{ padding: 0, overflow: 'visible' }}>{q.isLoading ? <div style={{ padding: '8px 16px' }}><SkeletonRows count={6} /></div> : q.isError ? <ErrorRetry queryKey={['tasks', 'list', status, priority, search, isEmployee, page]} message="Could not load tasks. Check your connection and try again." /> : tasks.length === 0 ? <EmptyState icon={<IconClipboard size={14} />} title={search || status !== 'all' || priority !== 'all' ? 'No tasks match your filters' : isEmployee ? 'No tasks assigned to you yet' : 'No tasks yet'} sub={search || status !== 'all' || priority !== 'all' ? 'Try adjusting the filters above' : canCreate ? 'Create your first task to get started' : 'Tasks assigned to you will appear here.'} action={canCreate ? <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>+ Create First Task</button> : undefined} /> : <><div className="tasksDesktopTable tasksTableWrap" style={{ overflow: 'visible' }}><table className="tasksTable" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={{ width: 4, padding: 0 }} />{canManage && <th className="thCheckbox"><input type="checkbox" className="taskCheckbox" checked={tasks.length > 0 && selected.size === tasks.length} onChange={() => setSelected(prev => prev.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id)))} title="Select all" /></th>}<th className="thCell">Task</th><th className="thCell" style={{ minWidth: 160 }}>Priority Signal</th><th className="thCell">Project</th>{!isEmployee && <th className="thCell">Assignee</th>}<th className="thCell">Status</th><th className="thCell">Priority</th><th className="thCell">Due</th><th className="thCell" style={{ textAlign: 'right' }}>Comments</th></tr></thead><tbody>{tasks.slice(0, 200).map(task => { const due = dueStat(task.due_date); const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'; const dueColor = due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warn' ? '#8B5CF6' : 'var(--text2)'; const sig = buildTaskSignal(task, loadByUser); const isChecked = selected.has(task.id); return <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isChecked ? 'rgba(226,171,65,0.06)' : undefined, opacity: isProjectLocked(task) ? 0.86 : 1 }} onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}><td style={{ padding: 0, width: 4 }}><div style={{ width: 4, height: 52, background: isProjectLocked(task) ? '#f59e0b' : pColor }} /></td>{canManage && <td className="thCheckbox" onClick={e => { e.stopPropagation(); toggleSelect(task.id) }}><input type="checkbox" className="taskCheckbox" checked={isChecked} onChange={() => toggleSelect(task.id)} /></td>}<td style={{ padding: '10px 14px', maxWidth: 260 }} onClick={e => e.stopPropagation()}><InlineTitle task={task} canEdit={canCreate} onSaved={() => {}} /></td><td style={{ padding: '8px 14px', minWidth: 160 }}><div style={{ display: 'grid', gap: 3 }}><span className={signalBadgeClass(sig.level)} style={{ alignSelf: 'flex-start' }}>{sig.level === 'critical' ? '🔴 Critical' : sig.level === 'high' ? '🟠 High Risk' : sig.level === 'medium' ? '🟡 Monitor' : '🟢 On Track'}</span>{(sig.note || sig.loadNote) && <span style={{ fontSize: 10, color: sig.needsAttention ? '#f97316' : 'var(--muted)', lineHeight: 1.4, maxWidth: 155 }}>{sig.loadNote || sig.note}</span>}</div></td><td style={{ padding: '10px 14px' }}><ProjectCell task={task} /></td>{!isEmployee && <td style={{ padding: '10px 14px' }}>{task.assigned_to_name ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 26, height: 26, borderRadius: 8, background: hash(task.assigned_to_name) + '25', color: hash(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>{task.assigned_to_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</div><span style={{ fontSize: 12, fontWeight: 700 }}>{task.assigned_to_name}</span></div> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}</td>}<td style={{ padding: '8px 10px', minWidth: 140 }} onClick={e => e.stopPropagation()}><InlineStatus task={task} role={role} canChange={canChangeStatus} /></td><td style={{ padding: '10px 14px' }}>{task.priority ? <span style={{ fontSize: 12, fontWeight: 800, color: pColor, textTransform: 'capitalize' }}>{task.priority}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}</td><td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><span style={{ fontSize: 12, fontWeight: 700, color: dueColor }}>{due.label}</span></td><td style={{ padding: '10px 14px', textAlign: 'right' }} onClick={e => e.stopPropagation()}><button type="button" onClick={() => { setDrawerTab('comments'); setSelectedTaskId(task.id) }} style={{ border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', borderRadius: 10, padding: '5px 8px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}><MessageCircleMore size={14} /><span>{Number(task.message_count || 0)}</span><ChevronRight size={14} /></button></td></tr> })}</tbody></table></div>{pagination && pagination.pages > 1 && <div className="paginationBar"><span className="paginationInfo">{((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, pagination.total)} of {pagination.total} tasks</span><div className="paginationButtons"><button className="paginationBtn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button><button className="paginationBtn" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</button></div></div>}<div className="tasksMobileList">{tasks.map(task => { const due = dueStat(task.due_date); const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'; return <div key={task.id} style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', cursor: 'pointer', opacity: isProjectLocked(task) ? 0.86 : 1 }} onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}><div style={{ width: 4, flexShrink: 0, background: isProjectLocked(task) ? '#f59e0b' : pColor }} /><div style={{ flex: 1, padding: '12px 12px 12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 5 }}><ProjectLifecycleBadge task={task} compact />{task.project_name && <span style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 700 }}>{task.project_name}</span>}{task.priority && <span style={{ fontSize: 10, fontWeight: 800, color: pColor, background: pColor + '18', padding: '2px 7px', borderRadius: 6 }}>{task.priority}</span>}<span style={{ fontSize: 10, fontWeight: 700 }}>{due.label}</span></div></div><div onClick={e => e.stopPropagation()} style={{ flexShrink: 0, alignSelf: 'center' }}><InlineStatus task={task} role={role} canChange={canChangeStatus} /></div></div></div>})}</div></>}</div>
      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} initialTab={drawerTab} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
