import { useMemo, useState, useRef, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { ChevronRight, MessageCircleMore } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'

type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
  message_count?: number
}

function fetchTasks(status: string, priority: string, search: string, mine: boolean) {
  const qs = new URLSearchParams({ limit: '200', page: '1' })
  if (status !== 'all') qs.set('status', status)
  if (priority !== 'all') qs.set('priority', priority)
  if (search.trim()) qs.set('search', search.trim())
  if (mine) qs.set('mine', 'true')   // employee: only own tasks
  return apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?${qs}`)
    .then(d => (d.tasks || d.rows || []) as Task[])
}

async function renameTask(id: string, title: string) {
  return apiFetch(`/api/v1/tasks/${id}/rename`, { method: 'PATCH', json: { title } })
}
async function changeStatus(id: string, status: string) {
  return apiFetch(`/api/v1/tasks/${id}/status`, { method: 'PATCH', json: { status } })
}

function dueStat(iso?: string | null): { label: string; tone: string } {
  if (!iso) return { label: '—', tone: '' }
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return { label: '—', tone: '' }
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
  if (role === 'employee') {
    const map: Record<string, string[]> = {
      pending: ['in_progress'],
      in_progress: ['pending', 'completed'],
      completed: ['in_progress'],
      overdue: ['in_progress'],
    }
    return map[fromStatus] || []
  }
  return ['pending', 'in_progress', 'completed', 'overdue'].filter(s => s !== fromStatus)
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

/** Inline status badge — click to change */
function InlineStatus({ task, role }: { task: Task; role: string }) {
  const qc = useQueryClient()
  const transitions = getAllowedTransitions(task.status, role)
  const meta = STATUS_OPTIONS[task.status] || { label: task.status.replace(/_/g, ' '), color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }

  const m = useMutation({
    mutationFn: (s: string) => changeStatus(task.id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
    onError: (err: any) => {
      const message = err?.message || 'Status update failed. Transition may not be allowed.'
      window.alert(message)
    },
  })

  if (transitions.length === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color }} />
        {meta.label}
      </span>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <Select
        value={task.status}
        onChange={s => m.mutate(s)}
        options={[
          { value: task.status, label: meta.label, color: meta.color },
          ...transitions.map(s => {
            const tm = STATUS_OPTIONS[s] || { label: s.replace(/_/g, ' '), color: '#9ca3af', bg: '' }
            return { value: s, label: tm.label, color: tm.color }
          }),
        ]}
      />
    </div>
  )
}

export function TasksPage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const isEmployee = me?.role === 'employee'
  const role = me?.role || 'employee'

  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [search, setSearch] = useState('')
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>((location.state as any)?.openTaskId || null)
  const [drawerTab, setDrawerTab] = useState<'details' | 'comments'>('details')

  const q = useQuery({
    queryKey: ['tasks', 'list', status, priority, search, isEmployee],
    queryFn: () => fetchTasks(status, priority, search, isEmployee),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const tasks = q.data || []

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
              {isEmployee ? 'Tasks assigned to you. Start, submit, or track your work.' : 'Create, assign, and track tasks. Click a status badge to change it inline.'}
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
      </div>

      {/* ── Filters ── */}
      <div className="chartV3" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
            {[
              { k: 'all', label: 'All', count: counts.all },
              { k: 'pending', label: 'Pending', count: counts.pending },
              { k: 'in_progress', label: 'In Progress', count: counts.in_progress },
              { k: 'completed', label: 'Done', count: counts.completed },
              { k: 'overdue', label: 'Overdue', count: counts.overdue },
            ].map(f => (
              <button key={f.k} type="button" onClick={() => setStatus(f.k)} style={{
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
          <div style={{ width: 160, flexShrink: 0 }}>
            <Select value={priority} onChange={setPriority} options={PRIORITY_OPTS} />
          </div>
          <div style={{ width: 240, flexShrink: 0 }}>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks…"
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
            />
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="chartV3" style={{ padding: 0, overflow: 'visible' }}>
        {q.isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <svg className="animate-rotate" width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 8px', display: 'block' }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Loading tasks…
          </div>
        ) : tasks.length === 0 ? (
          <div className="emptyStateV3" style={{ padding: '48px 24px' }}>
            <div className="emptyStateV3Icon">📋</div>
            <div className="emptyStateV3Title">{search || status !== 'all' || priority !== 'all' ? 'No tasks match your filters' : isEmployee ? 'No tasks assigned to you yet' : 'No tasks yet'}</div>
            <div className="emptyStateV3Body">{search || status !== 'all' || priority !== 'all' ? 'Try adjusting the filters above' : canCreate ? 'Create your first task to get started' : 'Check back when your manager assigns you work'}</div>
            {canCreate && (
              <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create First Task
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflow: 'visible' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task</th>
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
                  return (
                    <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s', cursor: 'pointer' }}
                      onClick={() => { setDrawerTab('details'); setSelectedTaskId(task.id) }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: 0, width: 4 }} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 4, height: 48, background: pColor }} />
                      </td>
                      <td style={{ padding: '10px 14px', maxWidth: 260 }}>
                        <InlineTitle task={task} canEdit={canCreate} onSaved={() => {}} />
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
                        <InlineStatus task={task} role={role} />
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
        )}
      </div>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} initialTab={drawerTab} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
