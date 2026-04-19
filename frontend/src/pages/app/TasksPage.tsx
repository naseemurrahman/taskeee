import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

type Task = {
  id: string; title?: string; status: string; priority?: string | null
  due_date?: string | null; category_id?: string | null; category_name?: string | null
  category_color?: string | null; assigned_to?: string | null; assigned_to_name?: string | null
  created_at?: string
}

async function fetchTasks() {
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>('/api/v1/tasks?limit=500&page=1')
  return (d.tasks || d.rows || []) as Task[]
}

function formatDue(iso?: string | null): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' | 'none' } {
  if (!iso) return { label: 'No date', tone: 'none' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: 'No date', tone: 'none' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'overdue' }
  if (days === 0) return { label: 'Today', tone: 'today' }
  if (days === 1) return { label: 'Tomorrow', tone: 'soon' }
  if (days < 7) return { label: `In ${days} days`, tone: 'soon' }
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: 'future' }
}

function hashColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 55%)`
}

export function TasksPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'overdue'>('all')
  const tasksQ = useQuery({ queryKey: ['tasks','list'], queryFn: fetchTasks })

  const tasks = tasksQ.data || []

  const counts = useMemo(() => {
    const c = { all: tasks.length, pending: 0, in_progress: 0, completed: 0, overdue: 0 }
    for (const t of tasks) {
      if (t.status === 'pending') c.pending++
      else if (t.status === 'in_progress') c.in_progress++
      else if (t.status === 'completed' || t.status === 'manager_approved') c.completed++
      else if (t.status === 'overdue') c.overdue++
    }
    return c
  }, [tasks])

  const filtered = useMemo(() => {
    let out = tasks
    if (filter !== 'all') {
      out = out.filter(t => {
        if (filter === 'completed') return t.status === 'completed' || t.status === 'manager_approved'
        return t.status === filter
      })
    }
    if (search.trim()) {
      const s = search.toLowerCase()
      out = out.filter(t =>
        (t.title || '').toLowerCase().includes(s) ||
        (t.category_name || '').toLowerCase().includes(s) ||
        (t.assigned_to_name || '').toLowerCase().includes(s)
      )
    }
    return out
  }, [tasks, filter, search])

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* Header */}
      <div className="dashHeaderV3">
        <div>
          <div className="dashGreetTitle" style={{ fontSize: 24 }}>
            📋 Tasks
          </div>
          <div className="dashSubtitle">
            {tasks.length} total tasks
            <span className="dashHeroStat good">
              {counts.completed} done
            </span>
            {counts.overdue > 0 && (
              <span className="dashHeroStat bad">
                {counts.overdue} overdue
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btnGhost btnSm" to="/app/board">Board view</Link>
          <Link className="btn btnPrimary btnSm" to="/app/my-tasks">My tasks</Link>
        </div>
      </div>

      {/* Filter tabs + Search */}
      <div className="chartV3" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12 }}>
            {([
              { k: 'all', label: 'All', c: counts.all },
              { k: 'pending', label: 'Pending', c: counts.pending },
              { k: 'in_progress', label: 'In Progress', c: counts.in_progress },
              { k: 'completed', label: 'Completed', c: counts.completed },
              { k: 'overdue', label: 'Overdue', c: counts.overdue },
            ] as const).map(f => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                type="button"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8,
                  background: filter === f.k ? 'var(--primary)' : 'transparent',
                  color: filter === f.k ? '#1a1d2e' : 'var(--text2)',
                  border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 800,
                  transition: 'all 0.15s',
                }}
              >
                {f.label}
                <span style={{
                  background: filter === f.k ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                  padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 900,
                }}>{f.c}</span>
              </button>
            ))}
          </div>
          <div className="topbarV2Search" style={{ maxWidth: 280 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks..."
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="chartV3" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflow: 'auto' }}>
          <table className="employeeTableV3">
            <thead>
              <tr>
                <th style={{ width: 3 }}></th>
                <th>Task</th>
                <th>Project</th>
                <th>Assignee</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {tasksQ.isLoading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                    Loading tasks…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="emptyStateV3">
                      <div className="emptyStateV3Icon">🔍</div>
                      <div className="emptyStateV3Title">No tasks found</div>
                      <div className="emptyStateV3Body">
                        {search || filter !== 'all' ? 'Try adjusting your filters' : 'Create your first task to get started'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map(t => {
                  const due = formatDue(t.due_date)
                  const dueColor = due.tone === 'overdue' ? '#ef4444' : due.tone === 'today' ? '#f4ca57' : due.tone === 'soon' ? '#f97316' : 'var(--text2)'
                  const priorityColor = t.priority === 'urgent' ? '#ef4444'
                    : t.priority === 'high' ? '#f97316'
                    : t.priority === 'medium' ? '#f4ca57'
                    : '#38bdf8'
                  return (
                    <tr key={t.id}>
                      <td style={{ padding: 0 }}>
                        <div style={{ width: 3, height: 36, background: priorityColor }}></div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 800, fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.title || t.id}
                        </div>
                      </td>
                      <td>
                        {t.category_name ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '3px 10px', borderRadius: 999,
                            background: (t.category_color || '#6366f1') + '18',
                            color: t.category_color || '#6366f1',
                            border: `1px solid ${(t.category_color || '#6366f1')}30`,
                            fontSize: 11, fontWeight: 800,
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.category_color || '#6366f1' }} />
                            {t.category_name}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td>
                        {t.assigned_to_name ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="avatarV3" style={{
                              width: 26, height: 26, fontSize: 10,
                              background: hashColor(t.assigned_to_name),
                            }}>
                              {t.assigned_to_name.split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase()}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{t.assigned_to_name}</span>
                          </div>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}
                      </td>
                      <td>
                        <span className={`statusBadge ${
                          t.status === 'overdue' ? 'statusOverdue'
                          : t.status === 'completed' || t.status === 'manager_approved' ? 'statusCompleted'
                          : t.status === 'in_progress' ? 'statusInProgress'
                          : t.status === 'submitted' ? 'statusSubmitted'
                          : 'statusPending'
                        }`}>
                          {t.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td>
                        {t.priority ? (
                          <span style={{
                            fontSize: 11, fontWeight: 800, color: priorityColor,
                            textTransform: 'capitalize',
                          }}>
                            {t.priority}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 700, color: dueColor }}>
                          {due.tone === 'overdue' && '⚠ '}
                          {due.tone === 'today' && '🎯 '}
                          {due.label}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--glass-border)',
            fontSize: 12, color: 'var(--muted)', textAlign: 'center',
          }}>
            Showing first 100 of {filtered.length} tasks
          </div>
        )}
      </div>
    </div>
  )
}
