import { useMemo, useState, useRef, type KeyboardEvent } from 'react'
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
type Task = {
  id: string
  title?: string
  status: string
  priority?: string | null
  due_date?: string | null
  category_id?: string | null
  category_name?: string | null
  category_color?: string | null
  assigned_to?: string | null
  assigned_to_name?: string | null
  message_count?: number
}

type WorkloadRow = { employee_id: string; employee_name?: string; open_tasks: number; total_tasks?: number }

function fetchTasks(status: string, priority: string, search: string, mine: boolean) {
  const qs = new URLSearchParams({ limit: '200', page: '1' })
  if (status !== 'all') qs.set('status', status)
  if (priority !== 'all') qs.set('priority', priority)
  if (search.trim()) qs.set('search', search.trim())
  if (mine) qs.set('mine', 'true')
  return apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?${qs}`).then(d => (d.tasks || d.rows || []) as Task[])
}

async function fetchWorkload() {
  try {
    const d = await apiFetch<{ employees: WorkloadRow[] }>('/api/v1/analytics/workload?days=30')
    return d.employees || []
  } catch { return [] }
}

async function renameTask(id: string, title: string) {
  return apiFetch(`/api/v1/tasks/${id}/rename`, { method: 'PATCH', json: { title } })
}
async function changeStatus(id: string, status: string) {
  return apiFetch(`/api/v1/tasks/${id}/set-status`, { method: 'POST', json: { status } })
}

function dueStat(iso?: string | null): { label: string; tone: string } {
  if (!iso) return { label: '—', tone: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: '—', tone: '' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  const days = Math.round((t.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'danger' }
  if (days === 0) return { label: 'Today', tone: 'warn' }
  if (days === 1) return { label: 'Tomorrow', tone: 'warn' }
  if (days < 7) return { label: `In ${days}d`, tone: '' }
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: '' }
}

function hash(s: string) {
  let h = 0
  for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444', urgent: '#ef4444',
}

const STATUS_OPTIONS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#e2ab41', bg: 'rgba(226,171,65,0.12)' },
  in_progress: { label: 'In Progress', color: '#818cf8', bg: 'rgba(99,102,241,0.12)' },
  submitted: { label: 'Submitted', color: '#f9e6a2', bg: 'rgba(226,171,65,0.12)' },
  manager_approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  manager_rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  completed: { label: 'Done', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  overdue: { label: 'Overdue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  cancelled: { label: 'Cancelled', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
}

function getAllowedTransitions(fromStatus: string, role: string): string[] {
  const all = ['pending', 'in_progress', 'submitted', 'manager_approved', 'manager_rejected', 'completed', 'overdue', 'cancelled']
  if (role === 'admin' || role === 'director') return all.filter(s => s !== fromStatus)
  const managerMap: Record<string, string[]> = {
    pending: ['in_progress', 'completed', 'cancelled'],
    overdue: ['in_progress', 'completed', 'pending', 'cancelled'],
    in_progress: ['submitted', 'completed', 'pending', 'cancelled'],
    submitted: ['manager_approved', 'manager_rejected', 'completed'],
    manager_approved: ['completed'],
    manager_rejected: ['pending', 'in_progress'],
    completed: ['pending', 'in_progress'],
    cancelled: ['pending'],
  }
  const employeeMap: Record<string, string[]> = {
    pending: ['in_progress'],
    overdue: ['in_progress'],
    in_progress: ['submitted', 'pending'],
    submitted: ['in_progress'],
    manager_approved: ['completed'],
    manager_rejected: ['in_progress'],
  }
  return (role === 'employee' ? employeeMap : managerMap)[fromStatus] || []
}

const PRIORITY_OPTS = [
  { value: 'all', label: 'All priorities' },
  { value: 'low', label: 'Low', color: '#38bdf8' },
  { value: 'medium', label: 'Medium', color: '#8B5CF6' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
]

function InlineTitle({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(task.title || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (title: string) => renameTask(task.id, title),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: () => { setEditing(false); setVal(task.title || '') },
  })
  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setVal(task.title || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 30)
  }
  function commit() {
    const t = val.trim()
    if (t && t !== task.title) m.mutate(t)
    else setEditing(false)
  }
  if (editing) {
    return (
      <input ref={inputRef} className="inlineEditInput" value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setVal(task.title || '') } }} onClick={e => e.stopPropagation()} style={{ fontSize: 13 }} />
    )
  }
  return (
    <div className="inlineEditWrap">
      <span style={{ fontWeight: 850, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.title || task.id}</span>
      {canEdit && <button className="inlineEditBtn" type="button" onClick={startEdit} title="Rename">✎</button>}
    </div>
  )
}

function InlineStatus({ task, role, canChange }: { task: Task; role: string; canChange: boolean }) {
  const qc = useQueryClient()
  const { success: toastSuccess } = useToast()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const transitions = canChange ? getAllowedTransitions(task.status, role) : []
  const meta = STATUS_OPTIONS[task.status] || { label: task.status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  const m = useMutation({
    mutationFn: (s: string) => changeStatus(task.id, s),
    onSuccess: (_data, newStatus) => {
      setErrMsg(null)
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      qc.invalidateQueries({ queryKey: ['tasks', 'board'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const label = STATUS_OPTIONS[newStatus]?.label || newStatus
      toastSuccess('Status updated', `Task moved to ${label}`)
    },
    onError: (err: any) => {
      const msg = err?.message || 'Failed to update status'
      console.error('[StatusChange] Error:', msg, err)
      setErrMsg(msg)
      setTimeout(() => setErrMsg(null), 6000)
    },
  })
  if (!canChange || transitions.length === 0) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 850, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`, whiteSpace: 'nowrap' }}>{meta.label}</span>
  }
  const options = [{ value: task.status, label: meta.label }, ...transitions.map(s => ({ value: s, label: STATUS_OPTIONS[s]?.label || s.replace(/_/g, ' ') }))]
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select value={task.status} disabled={m.isPending} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); const v = e.target.value; if (v !== task.status) m.mutate(v) }} style={{ padding: '5px 8px 5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 850, fontFamily: 'inherit', background: meta.bg, color: meta.color, border: `1.5px solid ${meta.color}55`, cursor: m.isPending ? 'not-allowed' : 'pointer', outline: 'none', minWidth: 120, opacity: m.isPending ? 0.6 : 1 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {errMsg && <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 9999, fontSize: 10, color: '#ef4444', fontWeight: 800, whiteSpace: 'nowrap', background: 'var(--bg1)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)' }}>⚠ {errMsg}</div>}
    </div>
  )
}

export function TasksPage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const isEmployee = isEmployeeRole(me?.role)
  const canChangeStatus = canChangeTaskStatus(me?.role)
  const role = me?.role || 'employee'
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [search, setSearch] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [aiSort, setAiSort] = useState(true)
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>((location.state as any)?.openTaskId || null)
  const [drawerTab, setDrawerTab] = useState<'details' | 'comments'>('details')

  const q = useQuery({ queryKey: ['tasks', 'list', status, priority, search, isEmployee], queryFn: () => fetchTasks(status, priority, search, isEmployee), staleTime: 20_000, refetchInterval: 30_000, refetchOnMount: true, refetchOnWindowFocus: true })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', 'tasks'], queryFn: fetchWorkload, staleTime: 45_000 })
  const tasks = q.data || []
  const loadByUser = useMemo(() => new Map((workloadQ.data || []).map(row => [row.employee_id, Number(row.open_tasks || 0)])), [workloadQ.data])

  const scoredTasks = useMemo(() => tasks.map(task => ({ task, signal: buildTaskSignal(task, loadByUser) })), [tasks, loadByUser])
  const visibleTasks = useMemo(() => {
    let rows = scoredTasks
    if (focusMode) rows = rows.filter(row => row.signal.needsAttention)
    if (aiSort) rows = rows.slice().sort((a, b) => b.signal.score - a.signal.score)
    return rows
  }, [aiSort, focusMode, scoredTasks])
  const riskyCount = scoredTasks.filter(row => row.signal.needsAttention).length

  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 }
    for (const t of tasks) {
      c.all++
      if (t.status === 'pending') c.pending++
      else if (t.status === 'in_progress') c.in_progress++
      else if (t.status === 'completed' || t.status === 'manager_approved') c.completed++
      else if (t.status === 'overdue') c.overdue++
    }
    return c
  }, [tasks])

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Tasks {isEmployee && <span className="roleBadge roleBadgeEmployee" style={{ marginLeft: 8 }}>My Tasks</span>}</div>
            <div className="pageHeaderCardSub">AI-assisted task list with focus mode, priority sorting, workload warnings, and inline execution signals.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} total</span>
              {counts.overdue > 0 && <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {counts.overdue} overdue</span>}
              {riskyCount > 0 && <span className="pageHeaderCardTag" style={{ color: '#f97316', background: 'rgba(249,115,22,0.10)', borderColor: 'rgba(249,115,22,0.24)' }}>AI: {riskyCount} need attention</span>}
            </div>
          </div>
          {canCreate && <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button">Create Task</button>}
        </div>
      </div>

      <div className="chartV3" style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={focusMode ? 'btn btnPrimary' : 'btn btnGhost'} onClick={() => setFocusMode(v => !v)}>Focus Mode</button>
            <button type="button" className={aiSort ? 'btn btnPrimary' : 'btn btnGhost'} onClick={() => setAiSort(v => !v)}>AI priority sort</button>
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 12, fontWeight: 750 }}>{visibleTasks.length} visible · {riskyCount} risk signals</div>
        </div>
        <div className="taskFiltersRow" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
            {[
              { k: 'all', label: 'All', count: counts.all },
              { k: 'pending', label: 'Pending', count: counts.pending },
              { k: 'in_progress', label: 'In Progress', count: counts.in_progress },
              { k: 'completed', label: 'Done', count: counts.completed },
              { k: 'overdue', label: 'Overdue', count: counts.overdue },
            ].map(f => <button key={f.k} type="button" onClick={() => setStatus(f.k)} className={status === f.k ? 'btn btnPrimary' : 'btn btnGhost'} style={{ minHeight: 34, padding: '5px 10px', fontSize: 12 }}>{f.label} <span style={{ opacity: .75 }}>({f.count})</span></button>)}
          </div>
          <div style={{ width: 170, flexShrink: 0 }}><Select value={priority} onChange={setPriority} options={PRIORITY_OPTS} /></div>
          <div style={{ width: 250, flexShrink: 0 }}><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks…" /></div>
        </div>
      </div>

      <div className="chartV3" style={{ padding: 0, overflow: 'visible' }}>
        {q.isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>Loading tasks…</div>
        ) : visibleTasks.length === 0 ? (
          <div className="emptyStateV3" style={{ padding: '48px 24px' }}>
            <div className="emptyStateV3Icon">📋</div>
            <div className="emptyStateV3Title">{focusMode ? 'No risky tasks match this view' : 'No tasks match your filters'}</div>
            <div className="emptyStateV3Body">Try changing filters or turning off Focus Mode.</div>
          </div>
        ) : (
          <div className="tasksTableWrap" style={{ overflowX: 'auto' }}>
            <table className="tasksTable" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Task</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>AI Signal</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Project</th>
                  {!isEmployee && <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Assignee</th>}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Priority</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Due</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase' }}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.slice(0, 200).map(({ task, signal }) => {
                  const due = dueStat(task.due_date)
                  const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
                  const dueColor = due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warn' ? '#8B5CF6' : 'var(--text2)'
                  const commentCount = Number(task.message_count || 0)
                  return (
                    <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}>
                      <td style={{ padding: 0, width: 4 }}><div style={{ width: 4, minHeight: 64, background: pColor }} /></td>
                      <td style={{ padding: '10px 14px', maxWidth: 280 }} onClick={e => e.stopPropagation()}><InlineTitle task={task} canEdit={canCreate} /></td>
                      <td style={{ padding: '10px 14px', minWidth: 190 }}>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={signalBadgeClass(signal.level)}>{signal.score}%</span>{signal.needsAttention && <span style={{ color: '#f97316', fontSize: 11, fontWeight: 850 }}>Needs attention</span>}</div>
                          <div style={{ color: signal.needsAttention ? '#f97316' : 'var(--text2)', fontSize: 11, fontWeight: 700 }}>{signal.note}</div>
                          {signal.loadNote && <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 800 }}>⚠ {signal.loadNote}</div>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px' }}>{task.category_name ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: (task.category_color || '#6366f1') + '18', color: task.category_color || '#818cf8', border: `1px solid ${(task.category_color || '#6366f1')}28` }}>{task.category_name}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}</td>
                      {!isEmployee && <td style={{ padding: '10px 14px' }}>{task.assigned_to_name ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 26, height: 26, borderRadius: 8, background: hash(task.assigned_to_name) + '25', color: hash(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>{task.assigned_to_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</div><span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{task.assigned_to_name}</span></div> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}</td>}
                      <td style={{ padding: '8px 10px', minWidth: 140 }} onClick={e => e.stopPropagation()}><InlineStatus task={task} role={role} canChange={canChangeStatus} /></td>
                      <td style={{ padding: '10px 14px' }}>{task.priority ? <span style={{ fontSize: 12, fontWeight: 850, color: pColor, textTransform: 'capitalize' }}>{task.priority}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><span style={{ fontSize: 12, fontWeight: 750, color: dueColor }}>{due.label}</span></td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }} onClick={e => e.stopPropagation()}><button type="button" onClick={() => { setDrawerTab('comments'); setSelectedTaskId(task.id) }} className="btn btnGhost" style={{ minHeight: 32, padding: '5px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><MessageCircleMore size={14} /><span>{commentCount}</span><ChevronRight size={14} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} initialTab={drawerTab} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
