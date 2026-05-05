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
import { buildTaskSignal, signalBadgeClass } from '../../utils/taskSignals'
import { useRealtimeInvalidation } from '../../lib/socket'
import { SkeletonRows, ErrorRetry, EmptyState } from '../../components/ui/PageStates'
type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
  message_count?: number
}

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
  // Use simple POST endpoint — minimal middleware, no transaction complexity
  return apiFetch(`/api/v1/tasks/${id}/set-status`, {
    method: 'POST', json: { status }
  })
}

function dueStat(iso?: string | null): { label: string; tone: string } {
  if (!iso) return { label: '—', tone: '' }
  // Handle Unix timestamp (seconds) — backend may send numeric strings
  let d: Date
  const numeric = Number(iso)
  if (!isNaN(numeric) && numeric > 1_000_000_000) {
    // Looks like a Unix timestamp in seconds — convert to ms
    d = new Date(numeric * 1000)
  } else {
    d = new Date(iso)
  }
  if (Number.isNaN(d.getTime())) return { label: '—', tone: '' }
  // Sanity check: if year is wildly off, ignore
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

const PRIORITY_COLOR: Record<string, string> = {
  low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444', urgent: '#ef4444',
}

const STATUS_OPTIONS: Record<string, { label: string; color: string; bg: string }> = {
  pending:          { label: 'Pending',          color: '#e2ab41', bg: 'rgba(226,171,65,0.12)'  },
  in_progress:      { label: 'In Progress',      color: '#818cf8', bg: 'rgba(99,102,241,0.12)'  },
  submitted:        { label: 'Submitted',        color: '#f9e6a2', bg: 'rgba(226,171,65,0.12)'  },
  manager_approved: { label: 'Approved',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  manager_rejected: { label: 'Rejected',         color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  completed:        { label: 'Done',             color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  overdue:          { label: 'Overdue',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  cancelled:        { label: 'Cancelled',        color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
}

// Allowed status transitions per role (mirrors backend)
function getAllowedTransitions(fromStatus: string, role: string): string[] {
  const ALL_STATUSES = ['pending', 'in_progress', 'submitted', 'manager_approved', 'manager_rejected', 'completed', 'overdue', 'cancelled']

  // Admin and director can transition to ANY status
  if (role === 'admin' || role === 'director') {
    return ALL_STATUSES.filter(s => s !== fromStatus)
  }

  const MAP: Record<string, Record<string, string[]>> = {
    hr: {
      pending: ['in_progress', 'completed', 'cancelled'],
      overdue: ['in_progress', 'completed', 'pending', 'cancelled'],
      in_progress: ['submitted', 'completed', 'pending', 'cancelled'],
      submitted: ['manager_approved', 'manager_rejected', 'completed'],
      manager_approved: ['completed'],
      manager_rejected: ['pending', 'in_progress'],
      completed: ['pending', 'in_progress'],
      cancelled: ['pending'],
    },
    manager: {
      pending: ['in_progress', 'completed', 'cancelled'],
      overdue: ['in_progress', 'completed', 'pending', 'cancelled'],
      in_progress: ['submitted', 'completed', 'pending', 'cancelled'],
      submitted: ['manager_approved', 'manager_rejected', 'completed'],
      manager_approved: ['completed'],
      manager_rejected: ['pending', 'in_progress'],
      completed: ['pending', 'in_progress'],
      cancelled: ['pending'],
    },
    supervisor: {
      pending: ['in_progress', 'completed', 'cancelled'],
      overdue: ['in_progress', 'completed', 'pending', 'cancelled'],
      in_progress: ['submitted', 'completed', 'pending', 'cancelled'],
      submitted: ['manager_approved', 'manager_rejected', 'completed'],
      manager_approved: ['completed'],
      manager_rejected: ['pending', 'in_progress'],
      completed: ['pending', 'in_progress'],
      cancelled: ['pending'],
    },
    employee: {
      pending: ['in_progress'],
      overdue: ['in_progress'],
      in_progress: ['submitted', 'pending'],
      submitted: ['in_progress'],
      manager_approved: ['completed'],
      manager_rejected: ['in_progress'],
    },
  }
  const roleMap = MAP[role] || MAP['manager']
  return roleMap[fromStatus] || []
}

const PRIORITY_OPTS = [
  { value: 'all', label: 'All priorities' },
  { value: 'low', label: 'Low', color: '#38bdf8' },
  { value: 'medium', label: 'Medium', color: '#8B5CF6' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
]

/** Inline title rename */
function InlineTitle({ task, canEdit, onSaved }: { task: Task; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(task.title || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const m = useMutation({
    mutationFn: (title: string) => renameTask(task.id, title),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); onSaved() },
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
      <input ref={inputRef} className="inlineEditInput" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setEditing(false); setVal(task.title || '') }
        }}
        onClick={e => e.stopPropagation()} style={{ fontSize: 13 }}
      />
    )
  }

  return (
    <div className="inlineEditWrap">
      <span style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {task.title || task.id}
      </span>
      {canEdit && (
        <button className="inlineEditBtn" type="button" onClick={startEdit} title="Rename">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}
    </div>
  )
}

/** Static status badge — no interaction */
function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_OPTIONS[status] || { label: status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  )
}

/** Inline status — native select, fully reliable cross-browser */
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
    return <StatusBadge status={task.status} />
  }

  const options = [
    { value: task.status, label: meta.label },
    ...transitions.map(s => {
      const tm = STATUS_OPTIONS[s] || { label: s.replace(/_/g, ' '), color: '#9ca3af', bg: '' }
      return { value: s, label: tm.label }
    }),
  ]

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
        {/* Status select — keep native appearance so dropdown opens properly */}
        <select
          value={task.status}
          disabled={m.isPending}
          onClick={e => e.stopPropagation()}
          onChange={e => {
            e.stopPropagation()
            const v = e.target.value
            if (v !== task.status) m.mutate(v)
          }}
          style={{
            paddingLeft: 10, paddingRight: 8, paddingTop: 5, paddingBottom: 5,
            borderRadius: 10, fontSize: 11, fontWeight: 800, fontFamily: 'inherit',
            background: meta.bg, color: meta.color,
            border: `1.5px solid ${meta.color}55`,
            cursor: m.isPending ? 'not-allowed' : 'pointer',
            outline: 'none', minWidth: 95, maxWidth: 130,
            opacity: m.isPending ? 0.6 : 1,
          }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {errMsg && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 9999, fontSize: 10, color: '#ef4444', fontWeight: 800, whiteSpace: 'nowrap', background: 'var(--bg1)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          ⚠ {errMsg}
        </div>
      )}
    </div>
  )
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

  // Auto-invalidate when any task changes via socket
  useRealtimeInvalidation({ tasks: true, dashboard: true })

  // Bulk task selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleAll = (ids: string[]) => setSelected(prev => prev.size === ids.length ? new Set() : new Set(ids))
  const clearSelected = () => setSelected(new Set())

  const bulkStatusM = useMutation({
    mutationFn: (newStatus: string) => Promise.all([...selected].map(id => apiFetch(`/api/v1/tasks/${id}/status`, { method: 'PATCH', json: { status: newStatus } }))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toastSuccess('Updated', `${selected.size} tasks updated`); clearSelected() },
    onError: () => toastError('Bulk update failed', 'Could not update selected tasks'),
  })

  const bulkDeleteM = useMutation({
    mutationFn: () => Promise.all([...selected].map(id => apiFetch(`/api/v1/tasks/${id}`, { method: 'DELETE' }))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toastSuccess('Deleted', `${selected.size} tasks deleted`); clearSelected() },
    onError: () => toastError('Delete failed', 'Could not delete selected tasks'),
  })

  const [status, setStatus]   = useState('all')
  const [priority, setPriority] = useState('all')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)

  // Reset to page 1 when any filter changes
  const handleStatusChange   = (v: string) => { setStatus(v);   setPage(1) }
  const handlePriorityChange = (v: string) => { setPriority(v); setPage(1) }
  const handleSearchChange   = (v: string) => { setSearch(v);   setPage(1) }
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>((location.state as any)?.openTaskId || null)
  const [drawerTab, setDrawerTab] = useState<'details' | 'comments'>('details')


  const q = useQuery({
    queryKey: ['tasks', 'list', status, priority, search, isEmployee, page],
    queryFn: () => fetchTasks(status, priority, search, isEmployee, page),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })

  // Workload data for AI signal scoring
  const workloadQ = useQuery({
    queryKey: ['analytics-workload', 'tasks-page'],
    queryFn: () => apiFetch<{ employees: Array<{ employee_id: string; open_tasks: number }> }>('/api/v1/analytics/workload?days=30').then(d => d.employees || []).catch(() => []),
    staleTime: 60_000,
  })
  const loadByUser = useMemo(() => new Map((workloadQ.data || []).map(w => [w.employee_id, Number(w.open_tasks || 0)])), [workloadQ.data])

  const tasks       = q.data?.tasks || []
  const pagination  = q.data?.pagination

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
      {/* ── Header ── */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>
              Tasks
              {isEmployee && <span className="roleBadge roleBadgeEmployee" style={{ marginLeft: 8 }}>My Tasks</span>}
            </div>
            <div className="pageHeaderCardSub">
              {isEmployee ? 'Tasks assigned to you. Track your work and collaborate through comments/attachments.' : 'Create, assign, and track tasks. Click a status badge to change it inline.'}
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} total</span>
              {counts.overdue > 0 && <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {counts.overdue} overdue</span>}
              {counts.completed > 0 && <span className="pageHeaderCardTag" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.22)' }}>✓ {counts.completed} done</span>}
            </div>
          </div>
          {canCreate && (
            <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Task
            </button>
          )}
        </div>

        {/* Filters merged directly into header — no second card */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
            {[
              { k: 'all', label: 'All', count: counts.all },
              { k: 'pending', label: 'Pending', count: counts.pending },
              { k: 'in_progress', label: 'In Progress', count: counts.in_progress },
              { k: 'completed', label: 'Done', count: counts.completed },
              { k: 'overdue', label: 'Overdue', count: counts.overdue },
            ].map(f => (
              <button key={f.k} type="button" onClick={() => handleStatusChange(f.k)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800,
                background: status === f.k ? 'var(--brand)' : 'var(--bg2)',
                color: status === f.k ? '#1a1d2e' : 'var(--text2)',
                transition: 'all 0.12s',
              }}>
                {f.label}
                <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 900, background: status === f.k ? 'rgba(0,0,0,0.15)' : 'var(--surfaceUp)' }}>{f.count}</span>
              </button>
            ))}
          </div>
          <div style={{ width: 'min(150px, 100%)', flexShrink: 0 }}>
            <Select value={priority} onChange={handlePriorityChange} options={PRIORITY_OPTS} />
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 120 }}>
            <Input value={search} onChange={e => handleSearchChange(e.target.value)} placeholder="Search tasks…"
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
            />
          </div>
        </div>
      </div>

      {/* Bulk action bar — shown when items are selected */}
      {selected.size > 0 && canManage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(226,171,65,0.10)', border: '1.5px solid rgba(226,171,65,0.3)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--brand)' }}>{selected.size} selected</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['in_progress','submitted','completed'] as const).map(s => (
              <button key={s} className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 12 }}
                onClick={() => bulkStatusM.mutate(s)} disabled={bulkStatusM.isPending}>
                → {s.replace(/_/g,' ')}
              </button>
            ))}
            {canCreate && (
              <button className="btn" style={{ height: 30, padding: '0 10px', fontSize: 12, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
                onClick={() => { if (confirm(`Delete ${selected.size} tasks? This cannot be undone.`)) bulkDeleteM.mutate() }} disabled={bulkDeleteM.isPending}>
                Delete {selected.size}
              </button>
            )}
          </div>
          <button onClick={clearSelected} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="chartV3" style={{ padding: 0, overflow: 'visible' }}>
        {q.isLoading ? (
          <div style={{ padding: '8px 16px' }}><SkeletonRows count={6} /></div>
        ) : q.isError ? (
          <ErrorRetry queryKey={['tasks', 'list', status, priority, search, isEmployee, page]} message="Could not load tasks. Check your connection and try again." />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="📋"
            title={search || status !== 'all' || priority !== 'all' ? 'No tasks match your filters' : isEmployee ? 'No tasks assigned to you yet' : 'No tasks yet'}
            sub={search || status !== 'all' || priority !== 'all' ? 'Try adjusting the filters above' : canCreate ? 'Create your first task to get started' : 'Tasks assigned to you will appear here.'}
            action={canCreate ? (
              <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>
                + Create First Task
              </button>
            ) : undefined}
          />
        ) : (
          <>\n          {/* Desktop table — hidden on mobile */}\n          <div className="tasksDesktopTable tasksTableWrap" style={{ overflow: 'visible' }}>
            <table className="tasksTable" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  {canManage && (
                    <th style={{ width: 36, padding: '10px 8px 10px 14px' }}>
                      <input type="checkbox" checked={tasks.length > 0 && selected.size === tasks.length}
                        onChange={() => toggleAll(tasks.map(t => t.id))}
                        style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#e2ab41' }} />
                    </th>
                  )}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 160 }}>AI Signal</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Project</th>
                  {!isEmployee && <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Assignee</th>}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Priority</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Due</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 200).map(task => {
                  const due = dueStat(task.due_date)
                  const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
                  const dueColor = due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warn' ? '#8B5CF6' : 'var(--text2)'
                  const commentCount = Number(task.message_count || 0)
                  const isChecked = selected.has(task.id)
                  return (
                    <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s', cursor: 'pointer', background: isChecked ? 'rgba(226,171,65,0.06)' : undefined }}
                      onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}
                      onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = 'var(--bg2)' }}
                      onMouseLeave={e => { if (!isChecked) e.currentTarget.style.background = '' }}>
                      <td style={{ padding: 0, width: 4 }} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 4, height: 48, background: pColor }} />
                      </td>
                      {canManage && (
                        <td style={{ padding: '10px 8px 10px 14px', width: 36 }} onClick={e => { e.stopPropagation(); toggleSelect(task.id) }}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(task.id)}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#e2ab41' }} />
                        </td>
                      )}
                      <td style={{ padding: '10px 14px', maxWidth: 260 }} onClick={e => e.stopPropagation()}>
                        <InlineTitle task={task} canEdit={canCreate} onSaved={() => {}} />
                      </td>
                      <td style={{ padding: '8px 14px', minWidth: 160 }} onClick={e => e.stopPropagation()}>
                        {workloadQ.isLoading ? (
                          <div style={{ width: 48, height: 20, borderRadius: 999, background: 'var(--border)', opacity: 0.5 }} />
                        ) : (() => {
                          const sig = buildTaskSignal(task, loadByUser)
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span className={signalBadgeClass(sig.level)} style={{ alignSelf: 'flex-start' }}>
                                {sig.score}%{sig.needsAttention ? ' Needs attention' : ''}
                              </span>
                              {(sig.note || sig.loadNote) && (
                                <span style={{ fontSize: 10, color: sig.needsAttention ? '#f97316' : 'var(--muted)', lineHeight: 1.4, maxWidth: 155 }}>
                                  {sig.loadNote || sig.note}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {task.category_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: (task.category_color || '#6366f1') + '18', color: task.category_color || '#818cf8', border: `1px solid ${(task.category_color || '#6366f1')}28` }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: task.category_color || '#818cf8' }} />
                            {task.category_name}
                          </span>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                      </td>
                      {!isEmployee && (
                        <td style={{ padding: '10px 14px' }}>
                          {task.assigned_to_name ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: hash(task.assigned_to_name) + '25', border: `1.5px solid ${hash(task.assigned_to_name)}40`, color: hash(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>
                                {task.assigned_to_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{task.assigned_to_name}</span>
                            </div>
                          ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}
                        </td>
                      )}
                      <td style={{ padding: '8px 10px', minWidth: 140 }} onClick={e => e.stopPropagation()}>
                        <InlineStatus task={task} role={role} canChange={canChangeStatus} />
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {task.priority ? <span style={{ fontSize: 12, fontWeight: 800, color: pColor, textTransform: 'capitalize' }}>{task.priority}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: dueColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {due.tone === 'danger' && <span aria-hidden="true">!</span>}
                          {due.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => { setDrawerTab('comments'); setSelectedTaskId(task.id) }}
                          style={{
                            border: '1px solid var(--border)',
                            background: 'var(--bg2)',
                            color: 'var(--text2)',
                            borderRadius: 10,
                            padding: '5px 8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                          title="Open task comments"
                          aria-label="Open task comments"
                        >
                          <MessageCircleMore size={14} />
                          <span>{commentCount}</span>
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination bar */}
          {pagination && pagination.pages > 1 && (
            <div className="paginationBar">
              <span className="paginationInfo">
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, pagination.total)} of {pagination.total} tasks
              </span>
              <div className="paginationButtons">
                <button className="paginationBtn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                {Array.from({ length: Math.min(pagination.pages, 7) }, (_, i) => {
                  const p = pagination.pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pagination.pages - 3 ? pagination.pages - 6 + i : page - 3 + i
                  return <button key={p} className={`paginationBtn ${p === page ? 'paginationBtnActive' : ''}`} onClick={() => setPage(p)}>{p}</button>
                })}
                <button className="paginationBtn" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}

          {/* Mobile card list — shown at ≤700px via CSS */}
          <div className="tasksMobileList">
            {tasks.map(task => {
              const due = dueStat(task.due_date)
              const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
              const dueColor = due.tone === 'danger' ? '#ef4444' : due.tone === 'warn' ? '#8B5CF6' : 'var(--text2)'
              const isChecked = selected.has(task.id)
              return (
                <div key={task.id}
                  style={{ display: 'flex', alignItems: 'stretch', background: isChecked ? 'rgba(226,171,65,0.07)' : 'transparent', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}>
                  {/* Priority stripe */}
                  <div style={{ width: 4, flexShrink: 0, background: pColor }} />
                  <div style={{ flex: 1, padding: '12px 12px 12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                    {/* Checkbox — only when bulk mode is active (something already selected) */}
                    {canManage && selected.size > 0 && (
                      <div onClick={e => { e.stopPropagation(); toggleSelect(task.id) }} style={{ paddingTop: 2, flexShrink: 0 }}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(task.id)}
                          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#e2ab41' }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title */}
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.3, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {task.title}
                      </div>
                      {/* AI signal warning — only when attention needed, strip newlines */}
                      {!workloadQ.isLoading && (() => {
                        const sig = buildTaskSignal(task, loadByUser)
                        const note = (sig.loadNote || sig.note || '').replace(/\n/g, ' ').trim()
                        return sig.needsAttention && note ? (
                          <div style={{ fontSize: 11, color: '#f97316', marginBottom: 5, lineHeight: 1.3 }}>
                            {sig.score}% · {note}
                          </div>
                        ) : null
                      })()}
                      {/* Meta row: assignee + priority + due */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                        {task.assigned_to_name && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', letterSpacing: '-0.01em' }}>
                            {task.assigned_to_name.split(' ')[0]}
                          </span>
                        )}
                        {task.priority && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: pColor, background: pColor + '18', padding: '2px 7px', borderRadius: 6 }}>
                            {task.priority}
                          </span>
                        )}
                        {due.label && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: dueColor }}>{due.label}</span>
                        )}
                      </div>
                    </div>
                    {/* Status — compact native select */}
                    <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0, alignSelf: 'center' }}>
                      <InlineStatus task={task} role={role} canChange={canChangeStatus} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} initialTab={drawerTab} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
