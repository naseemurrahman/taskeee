import { useMemo, useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canChangeTaskStatus, isEmployeeRole } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'

type Task = {
  id: string; title: string; status: string; priority?: string | null
  category_name?: string | null; category_color?: string | null
  assigned_to_name?: string | null; due_date?: string | null
  message_count?: number
}

async function patchStatus(taskId: string, status: string) {
  return apiFetch(`/api/v1/tasks/${taskId}/board-status`, {
    method: 'PATCH',
    json: { status, force: true, source: 'board_drag' },
  })
}

const COLUMNS = [
  { key: 'pending',          label: 'To Do',       color: '#f59e0b', icon: '○' },
  { key: 'in_progress',      label: 'In Progress',  color: '#8B5CF6', icon: '◑' },
  { key: 'submitted',        label: 'Submitted',    color: '#38bdf8', icon: '◉' },
  { key: 'manager_approved', label: 'Approved',     color: '#22c55e', icon: '✓' },
  { key: 'completed',        label: 'Done',         color: '#22c55e', icon: '●' },
  { key: 'overdue',          label: 'Overdue',      color: '#ef4444', icon: '⚠' },
]

// Columns you cannot drop onto
const NO_DROP_COLS = new Set(['overdue'])

const PRIORITY_COLOR: Record<string, string> = { low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444' }

function hashColor(s: string) {
  let h = 0; for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}

function DueLabel({ iso }: { iso?: string | null }) {
  if (!iso) return null
  const d = new Date(iso); const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  const color = days < 0 ? '#ef4444' : days <= 1 ? '#f59e0b' : '#9ca3af'
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return <span style={{ fontSize: 10, fontWeight: 700, color }}>{label}</span>
}

export function BoardPage() {
  const me = getUser()
  const canManage = canCreateTasksAndProjects(me?.role)
  const canDrag = canChangeTaskStatus(me?.role)
  const isEmployee = isEmployeeRole(me?.role)
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // ── Drag state (all in refs to avoid stale closures in event handlers) ──
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const draggingIdRef  = useRef<string | null>(null)
  const dragTaskRef    = useRef<Task | null>(null)
  const fromColRef     = useRef<string | null>(null)
  const ghostRef       = useRef<HTMLDivElement | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'board', isEmployee],
    queryFn: () => apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?limit=300&page=1${isEmployee ? '&mine=true' : ''}`).then(d => (d.tasks || d.rows || []) as Task[]),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const tasks = data || []

  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'board', isEmployee] })
      const previous = qc.getQueryData<Task[]>(['tasks', 'board', isEmployee])
      qc.setQueryData<Task[]>(['tasks', 'board', isEmployee], (old) =>
        (old || []).map(t => t.id === id ? { ...t, status } : t)
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['tasks', 'board', isEmployee], context.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const byCol = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const t of tasks) {
      const key = COLUMNS.find(c => c.key === t.status)?.key || 'pending'
      map[key].push(t)
    }
    return map
  }, [tasks])

  // ── HTML5 Drag handlers ──────────────────────────────────────────────────
  // All state mutations happen in refs so event handlers never see stale values.

  const onDragStart = useCallback((e: React.DragEvent, task: Task, colKey: string) => {
    dragTaskRef.current   = task
    fromColRef.current    = colKey
    draggingIdRef.current = task.id
    setDraggingId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
  }, [])

  const onDragEnd = useCallback((_e: React.DragEvent) => {
    draggingIdRef.current = null
    dragTaskRef.current   = null
    fromColRef.current    = null
    setDraggingId(null)
    setDragOverCol(null)
  }, [])

  const onColDragOver = useCallback((e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (NO_DROP_COLS.has(colKey)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colKey)
  }, [])

  const onColDragEnter = useCallback((e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    if (!NO_DROP_COLS.has(colKey)) setDragOverCol(colKey)
  }, [])

  const onColDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDragOverCol(null)
    }
  }, [])

  const onColDrop = useCallback((e: React.DragEvent, toColKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverCol(null)

    if (NO_DROP_COLS.has(toColKey)) return

    const task        = dragTaskRef.current
    const currentFrom = fromColRef.current

    // Clear all drag state immediately
    draggingIdRef.current = null
    dragTaskRef.current   = null
    fromColRef.current    = null
    setDraggingId(null)

    if (!task) return
    if (!canDrag) return
    if (currentFrom === toColKey) return

    m.mutate({ id: task.id, status: toColKey })
  }, [canDrag, m])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="16" rx="1"/></svg>
              Board
            </div>
            <div className="pageHeaderCardSub">
              {isEmployee
                ? 'Your tasks by status. Click a card to view details.'
                : 'Drag tasks between columns to update status. Click a card to view details.'}
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} tasks</span>
              {byCol.overdue?.length > 0 && (
                <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>
                  ⚠ {byCol.overdue.length} overdue
                </span>
              )}
              {!canDrag && <span className="pageHeaderCardTag" style={{ color: '#9ca3af' }}>Read-only view</span>}
            </div>
          </div>
          {canManage && (
            <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Task
            </button>
          )}
        </div>
      </div>

      {/* Mutation error */}
      {m.isError && (
        <div style={{ padding: '10px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
          ⚠ Failed to update status. {(m.error as any)?.message || 'Check your permissions.'}
        </div>
      )}

      {/* Board */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`, gap: 12 }}>
          {COLUMNS.map(col => (
            <div key={col.key} style={{ background: 'var(--bg2)', borderRadius: 16, padding: 14, minHeight: 300 }}>
              <div className="skeleton" style={{ height: 20, width: '60%', borderRadius: 8, marginBottom: 12 }} />
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12, marginBottom: 8 }} />)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))`, gap: 12, overflowX: 'auto', flex: 1, alignItems: 'start' }}>
          {COLUMNS.map(col => {
            const colTasks = byCol[col.key] || []
            const isOver   = dragOverCol === col.key && !NO_DROP_COLS.has(col.key)
            const isNoDrop = dragOverCol === col.key && NO_DROP_COLS.has(col.key)
            return (
              <div
                key={col.key}
                onDragEnter={e => onColDragEnter(e, col.key)}
                onDragOver={e => onColDragOver(e, col.key)}
                onDrop={e => onColDrop(e, col.key)}
                onDragLeave={onColDragLeave}
                style={{
                  background: isOver ? col.color + '12' : 'var(--bg2)',
                  borderRadius: 16,
                  padding: 14,
                  minHeight: 200,
                  border: `2px solid ${isOver ? col.color + '70' : isNoDrop ? '#ef444460' : 'transparent'}`,
                  transition: 'border-color 0.15s, background 0.15s',
                  boxSizing: 'border-box',
                }}
              >
                {/* Column header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: col.color }}>{col.icon}</span>
                  <span style={{ fontWeight: 900, fontSize: 13, color: 'var(--text)' }}>{col.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, background: col.color + '18', color: col.color }}>
                    {colTasks.length}
                  </span>
                </div>

                {/* Task cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colTasks.map(task => {
                    const pColor = PRIORITY_COLOR[task.priority || ''] || 'transparent'
                    const isDraggingThis = draggingId === task.id
                    return (
                      <div
                        key={task.id}
                        draggable={canDrag}
                        onDragStart={canDrag ? e => onDragStart(e, task, col.key) : undefined}
                        onDragEnd={canDrag ? onDragEnd : undefined}
                        onClick={() => {
                          if (!draggingIdRef.current) setSelectedTaskId(task.id)
                        }}
                        style={{
                          background: 'var(--bg1)',
                          borderRadius: 12,
                          padding: '10px 12px',
                          border: '1px solid var(--border)',
                          cursor: canDrag ? 'grab' : 'pointer',
                          opacity: isDraggingThis ? 0.35 : 1,
                          transition: 'opacity 0.1s, box-shadow 0.12s, border-color 0.12s',
                          position: 'relative',
                          userSelect: 'none',
                          pointerEvents: isDraggingThis ? 'none' : 'auto',
                        }}
                        onMouseEnter={e => {
                          if (isDraggingThis) return
                          const el = e.currentTarget as HTMLDivElement
                          el.style.borderColor = col.color + '60'
                          el.style.boxShadow = `0 4px 16px ${col.color}18`
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget as HTMLDivElement
                          el.style.borderColor = 'var(--border)'
                          el.style.boxShadow = ''
                        }}
                      >
                        {task.priority && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: pColor, borderRadius: '12px 12px 0 0' }} />
                        )}

                        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)', marginTop: task.priority ? 6 : 2, marginBottom: 6, lineHeight: 1.4 }}>
                          {task.title}
                        </div>

                        {canDrag && (
                          <div style={{ marginBottom: 6 }}>
                            <select
                              value={task.status}
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); m.mutate({ id: task.id, status: e.target.value }) }}
                              style={{ width: '100%', fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '4px 6px' }}
                            >
                              {COLUMNS.filter(c => !NO_DROP_COLS.has(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {task.category_name && (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: (task.category_color || '#818cf8') + '20', color: task.category_color || '#818cf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {task.category_name}
                            </span>
                          )}
                          <DueLabel iso={task.due_date} />
                        </div>

                        {(task.assigned_to_name || (task.message_count || 0) > 0) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                            {task.assigned_to_name && (
                              <>
                                <div style={{ width: 18, height: 18, borderRadius: 6, background: hashColor(task.assigned_to_name) + '30', color: hashColor(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>
                                  {task.assigned_to_name.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()}
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  {task.assigned_to_name}
                                </span>
                              </>
                            )}
                            {(task.message_count || 0) > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto', flexShrink: 0 }}>
                                💬 {task.message_count}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Empty state / drop target */}
                  {colTasks.length === 0 && (
                    <div style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      border: `2px dashed ${isOver ? col.color + '80' : col.color + '28'}`,
                      borderRadius: 12,
                      color: isOver ? col.color : 'var(--muted)',
                      fontSize: 11,
                      fontWeight: 700,
                      transition: 'all 0.15s',
                      pointerEvents: 'none',
                    }}>
                      {isOver ? '↓ Drop here' : canDrag && !NO_DROP_COLS.has(col.key) ? 'Drop here' : 'No tasks'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {ghostRef && null /* ghost element placeholder */}
      {canManage && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
