import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getApiErrorMessage } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canChangeTaskStatus, isEmployeeRole } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'

type Task = {
  id: string; title: string; status: string; priority?: string | null
  category_name?: string | null; category_color?: string | null
  assigned_to_name?: string | null; due_date?: string | null
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
  const canDrag = canChangeTaskStatus(me?.role)  // employees cannot drag/change status
  const isEmployee = isEmployeeRole(me?.role)
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; fromCol: string } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragTask = useRef<Task | null>(null)
  const suppressCardClickRef = useRef(false)

  const { data, isLoading } = useQuery({ queryKey: ['tasks', 'board', isEmployee], queryFn: () => apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?limit=300&page=1${isEmployee ? '&mine=true' : ''}`).then(d => (d.tasks || d.rows || []) as Task[]), staleTime: 30_000, refetchInterval: 60_000 })
  const tasks = data || []
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t] as const)), [tasks])

  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchStatus(id, status),
    onSuccess: () => {
      setStatusError(null)
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => {
      setStatusError(getApiErrorMessage(err, 'Could not update task status.'))
    },
  })

  // Group tasks by column key
  const byCol = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const t of tasks) {
      const key = COLUMNS.find(c => c.key === t.status)?.key || 'pending'
      map[key].push(t)
    }
    return map
  }, [tasks])

  function onDragStart(e: React.DragEvent, task: Task, colKey: string) {
    if (!canDrag) return
    suppressCardClickRef.current = true
    dragTask.current = task
    setDragging({ id: task.id, fromCol: colKey })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.setData('application/x-task-id', task.id)
  }

  function onDragOver(e: React.DragEvent, colKey: string) {
    if (!canDrag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(colKey)
  }

  function onDrop(e: React.DragEvent, toColKey: string) {
    if (!canDrag) return
    e.preventDefault()
    setDragOver(null)

    const transferId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/x-task-id')
    const droppedTask = dragTask.current || (transferId ? taskById.get(transferId) || null : null)
    const fromCol = dragging?.fromCol || droppedTask?.status || null

    if (!droppedTask || fromCol === toColKey) {
      dragTask.current = null
      setDragging(null)
      return
    }

    m.mutate({ id: droppedTask.id, status: toColKey })
    dragTask.current = null
    setDragging(null)
  }

  function onDragEnd() {
    setDragging(null); setDragOver(null); dragTask.current = null
  }

  function onColumnDragLeave(e: React.DragEvent<HTMLDivElement>, colKey: string) {
    if (!canDrag || dragOver !== colKey) return
    const rect = e.currentTarget.getBoundingClientRect()
    const { clientX, clientY } = e
    const leftColumnBounds = clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom
    if (leftColumnBounds) setDragOver(null)
  }

  function onQuickMove(taskId: string, nextStatus: string) {
    if (!canDrag) return
    m.mutate({ id: taskId, status: nextStatus })
  }

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
            <div className="pageHeaderCardSub">{isEmployee ? 'Your assigned tasks by status. Click a card to view details and add comments.' : 'Drag tasks between columns to update status. Click a card to view details.'}</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} tasks</span>
              {byCol.overdue?.length > 0 && <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {byCol.overdue.length} overdue</span>}
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

      {/* Board */}
      {statusError ? <div className="alert alertError">{statusError}</div> : null}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          {COLUMNS.map(col => (
            <div key={col.key} style={{ background: 'var(--bg2)', borderRadius: 16, padding: 14, minHeight: 400 }}>
              <div className="skeleton" style={{ height: 20, width: '60%', borderRadius: 8, marginBottom: 12 }} />
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12, marginBottom: 8 }} />)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))`, gap: 12, overflowX: 'auto', flex: 1, alignItems: 'start' }}>
          {COLUMNS.map(col => {
            const colTasks = byCol[col.key] || []
            const isOver = dragOver === col.key
            return (
              <div key={col.key}
                onDragEnter={e => onDragOver(e, col.key)}
                onDragOver={e => onDragOver(e, col.key)}
                onDrop={e => onDrop(e, col.key)}
                onDragLeave={e => onColumnDragLeave(e, col.key)}
                style={{
                  background: isOver ? (col.color + '10') : 'var(--bg2)',
                  borderRadius: 16, padding: 14, minHeight: 200,
                  border: `2px solid ${isOver ? col.color + '60' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                {/* Column header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16, color: col.color }}>{col.icon}</span>
                  <span style={{ fontWeight: 900, fontSize: 13, color: 'var(--text)' }}>{col.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, background: col.color + '18', color: col.color }}>{colTasks.length}</span>
                </div>

                {/* Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colTasks.map(task => {
                    const pColor = PRIORITY_COLOR[task.priority || ''] || 'transparent'
                    const isDragging = dragging?.id === task.id
                    return (
                      <div key={task.id}
                        draggable={canDrag}
                        onDragStart={e => canDrag ? onDragStart(e, task, col.key) : undefined}
                        onDragEnd={canDrag ? onDragEnd : undefined}
                        onClick={() => {
                          if (suppressCardClickRef.current) {
                            suppressCardClickRef.current = false
                            return
                          }
                          if (!dragging) setSelectedTaskId(task.id)
                        }}
                        style={{
                          background: 'var(--bg1)', borderRadius: 12, padding: '10px 12px',
                          border: '1px solid var(--border)', cursor: canDrag ? 'grab' : 'pointer',
                          opacity: isDragging ? 0.4 : 1, transition: 'all 0.12s',
                          position: 'relative', overflow: 'hidden',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = col.color + '60'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px ${col.color}18` }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
                      >
                        {/* Priority stripe */}
                        {task.priority && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2.5, background: pColor }} />}

                        <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.4, color: 'var(--text)', marginTop: 4, marginBottom: 6 }}>{task.title}</div>

                        {canDrag && (
                          <div style={{ marginBottom: 6 }}>
                            <select
                              value={task.status}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); onQuickMove(task.id, e.target.value) }}
                              style={{ width: '100%', fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '4px 6px' }}
                            >
                              {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {task.category_name && (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: (task.category_color || '#818cf8') + '20', color: task.category_color || '#818cf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{task.category_name}</span>
                          )}
                          <DueLabel iso={task.due_date} />
                        </div>

                        {task.assigned_to_name && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
                            <div style={{ width: 18, height: 18, borderRadius: 6, background: hashColor(task.assigned_to_name) + '30', color: hashColor(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>
                              {task.assigned_to_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.assigned_to_name}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Empty state per column */}
                  {colTasks.length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', border: `2px dashed ${col.color}28`, borderRadius: 12, color: 'var(--muted)', fontSize: 11 }}>
                      {canDrag ? 'Drop here' : 'No tasks'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canManage && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  )
}
