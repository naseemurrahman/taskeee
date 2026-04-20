import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'

type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
}

async function fetchTasks(status: string, priority: string, search: string) {
  const qs = new URLSearchParams({ limit: '200', page: '1' })
  if (status !== 'all') qs.set('status', status)
  if (priority !== 'all') qs.set('priority', priority)
  if (search.trim()) qs.set('search', search.trim())
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?${qs}`)
  return (d.tasks || d.rows || []) as Task[]
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
  low: '#38bdf8', medium: 'rgb(243,178,57)', high: '#f97316', critical: '#ef4444', urgent: '#ef4444',
}


const PRIORITY_OPTS = [
  { value: 'all', label: 'All priorities' },
  { value: 'low', label: 'Low', color: '#38bdf8' },
  { value: 'medium', label: 'Medium', color: 'rgb(243,178,57)' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
]

export function TasksPage() {
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const q = useQuery({
    queryKey: ['tasks', 'list', status, priority, search],
    queryFn: () => fetchTasks(status, priority, search),
    staleTime: 30_000,
    refetchInterval: 60_000,
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
      <div className="dashHeaderV3">
        <div>
          <div className="dashGreetTitle" style={{ fontSize: 22 }}>Tasks</div>
          <div className="dashSubtitle">
            <span>{tasks.length} tasks</span>
            {counts.overdue > 0 && <span className="dashHeroStat bad">⚠ {counts.overdue} overdue</span>}
            {counts.completed > 0 && <span className="dashHeroStat good">✓ {counts.completed} done</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btnPrimary"
            onClick={() => setCreateOpen(true)}
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 900 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Create Task
          </button>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div className="chartV3" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Status quick tabs */}
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
            {[
              { k: 'all', label: 'All', count: counts.all },
              { k: 'pending', label: 'Pending', count: counts.pending },
              { k: 'in_progress', label: 'In Progress', count: counts.in_progress },
              { k: 'completed', label: 'Done', count: counts.completed },
              { k: 'overdue', label: 'Overdue', count: counts.overdue },
            ].map(f => (
              <button
                key={f.k} type="button"
                onClick={() => setStatus(f.k)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 800,
                  background: status === f.k ? 'var(--brand)' : 'var(--bg2)',
                  color: status === f.k ? '#1a1d2e' : 'var(--text2)',
                  transition: 'all 0.12s',
                }}
              >
                {f.label}
                <span style={{
                  padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 900,
                  background: status === f.k ? 'rgba(0,0,0,0.15)' : 'var(--surfaceUp)',
                }}>{f.count}</span>
              </button>
            ))}
          </div>

          {/* Priority filter */}
          <div style={{ width: 160, flexShrink: 0 }}>
            <Select value={priority} onChange={setPriority} options={PRIORITY_OPTS} />
          </div>

          {/* Search */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks…"
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              }
            />
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="chartV3" style={{ padding: 0, overflow: 'hidden' }}>
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
            <div className="emptyStateV3Title">
              {search || status !== 'all' || priority !== 'all' ? 'No tasks match your filters' : 'No tasks yet'}
            </div>
            <div className="emptyStateV3Body">
              {search || status !== 'all' || priority !== 'all'
                ? 'Try adjusting the filters above'
                : 'Create your first task to get started'}
            </div>
            <button
              className="btn btnPrimary"
              onClick={() => setCreateOpen(true)}
              type="button"
              style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create First Task
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Project</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Assignee</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Priority</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 200).map(task => {
                  const due = dueStat(task.due_date)
                  const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
                  const dueColor = due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warn' ? 'rgb(243,178,57)' : 'var(--text2)'
                  return (
                    <tr
                      key={task.id}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      {/* Priority bar */}
                      <td style={{ padding: 0, width: 4 }}>
                        <div style={{ width: 4, height: 48, background: pColor }} />
                      </td>
                      {/* Title */}
                      <td style={{ padding: '12px 14px', maxWidth: 300 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.title || task.id}
                        </div>
                      </td>
                      {/* Project */}
                      <td style={{ padding: '12px 14px' }}>
                        {task.category_name ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                            background: (task.category_color || '#6366f1') + '18',
                            color: task.category_color || '#818cf8',
                            border: `1px solid ${(task.category_color || '#6366f1')}28`,
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: task.category_color || '#818cf8' }} />
                            {task.category_name}
                          </span>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                      </td>
                      {/* Assignee */}
                      <td style={{ padding: '12px 14px' }}>
                        {task.assigned_to_name ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                              background: hash(task.assigned_to_name) + '25',
                              border: `1.5px solid ${hash(task.assigned_to_name)}40`,
                              color: hash(task.assigned_to_name),
                              display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900,
                            }}>
                              {task.assigned_to_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{task.assigned_to_name}</span>
                          </div>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}
                      </td>
                      {/* Status */}
                      <td style={{ padding: '12px 14px' }}>
                        <span className={`statusBadge ${
                          task.status === 'completed' || task.status === 'manager_approved' ? 'statusCompleted'
                            : task.status === 'in_progress' ? 'statusInProgress'
                            : task.status === 'overdue' ? 'statusOverdue'
                            : task.status === 'submitted' ? 'statusSubmitted'
                            : 'statusPending'
                        }`}>
                          {task.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      {/* Priority */}
                      <td style={{ padding: '12px 14px' }}>
                        {task.priority ? (
                          <span style={{ fontSize: 12, fontWeight: 800, color: pColor, textTransform: 'capitalize' }}>
                            {task.priority}
                          </span>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                      </td>
                      {/* Due */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: dueColor }}>
                          {due.tone === 'danger' && '⚠ '}{due.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {tasks.length > 200 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                Showing 200 of {tasks.length} tasks. Use filters to narrow results.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Task Modal */}
      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
