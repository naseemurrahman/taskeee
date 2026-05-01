import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canChangeTaskStatus, isEmployeeRole } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'
import { buildTaskSignal, signalBadgeClass } from '../../utils/taskSignals'

type Task = {
  id: string
  title: string
  status: string
  priority?: string | null
  category_name?: string | null
  category_color?: string | null
  assigned_to?: string | null
  assigned_to_name?: string | null
  due_date?: string | null
  message_count?: number
}

type WorkloadRow = { employee_id: string; open_tasks: number }

const COLUMNS = [
  { key: 'pending', label: 'To Do', color: '#f59e0b', icon: '○' },
  { key: 'in_progress', label: 'In Progress', color: '#8B5CF6', icon: '◑' },
  { key: 'submitted', label: 'Submitted', color: '#38bdf8', icon: '◉' },
  { key: 'manager_approved', label: 'Approved', color: '#22c55e', icon: '✓' },
  { key: 'completed', label: 'Done', color: '#22c55e', icon: '●' },
  { key: 'overdue', label: 'Overdue', color: '#ef4444', icon: '⚠' },
]

const PRIORITY_COLOR: Record<string, string> = { low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444', urgent: '#ef4444' }

async function fetchTasks(isEmployee: boolean) {
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?limit=300&page=1${isEmployee ? '&mine=true' : ''}`)
  return (d.tasks || d.rows || []) as Task[]
}

async function fetchWorkload() {
  try {
    const d = await apiFetch<{ employees: WorkloadRow[] }>('/api/v1/analytics/workload?days=30')
    return d.employees || []
  } catch { return [] }
}

async function patchStatus(taskId: string, status: string) {
  return apiFetch(`/api/v1/tasks/${taskId}/set-status`, { method: 'POST', json: { status } })
}

function hashColor(s: string) {
  let h = 0
  for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}

function DueLabel({ iso }: { iso?: string | null }) {
  if (!iso) return null
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0,0,0,0)
  d.setHours(0,0,0,0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  const color = days < 0 ? '#ef4444' : days <= 1 ? '#f59e0b' : '#9ca3af'
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return <span style={{ fontSize: 10, fontWeight: 750, color }}>{label}</span>
}

export function BoardPage() {
  const me = getUser()
  const canManage = canCreateTasksAndProjects(me?.role)
  const canDrag = canChangeTaskStatus(me?.role)
  const isEmployee = isEmployeeRole(me?.role)
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)

  const tasksQ = useQuery({ queryKey: ['tasks', 'board'], queryFn: () => fetchTasks(isEmployee), staleTime: 30_000, refetchInterval: 60_000 })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', 'board'], queryFn: fetchWorkload, staleTime: 45_000 })
  const tasks = tasksQ.data || []
  const loadByUser = useMemo(() => new Map((workloadQ.data || []).map(w => [w.employee_id, Number(w.open_tasks || 0)])), [workloadQ.data])

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchStatus(id, status),
    onError: (err: any) => { setBoardError(err?.message || 'Status update failed'); setTimeout(() => setBoardError(null), 8000) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
  })

  const byCol = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const task of tasks) map[COLUMNS.find(c => c.key === task.status)?.key || 'pending'].push(task)
    return map
  }, [tasks])

  const riskyCount = useMemo(() => tasks.filter(task => buildTaskSignal(task, loadByUser).needsAttention).length, [tasks, loadByUser])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Board</div>
            <div className="pageHeaderCardSub">AI-assisted task board with risk, workload, and deadline signals.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} tasks</span>
              {byCol.overdue?.length > 0 && <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {byCol.overdue.length} overdue</span>}
              {riskyCount > 0 && <span className="pageHeaderCardTag" style={{ color: '#f97316', background: 'rgba(249,115,22,0.10)', borderColor: 'rgba(249,115,22,0.24)' }}>AI: {riskyCount} need attention</span>}
              {!canDrag && <span className="pageHeaderCardTag" style={{ color: '#9ca3af' }}>Read-only view</span>}
            </div>
          </div>
          {canManage && <button className="btn btnPrimary" onClick={() => setCreateOpen(true)}>Create Task</button>}
        </div>
      </div>

      {boardError && <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1.5px solid rgba(239,68,68,0.35)', color: '#ef4444', fontSize: 13, fontWeight: 800 }}>⚠ {boardError}</div>}

      {tasksQ.isLoading ? (
        <div className="p4BoardGrid">{COLUMNS.map(col => <div key={col.key} className="skeleton" style={{ height: 320, borderRadius: 20 }} />)}</div>
      ) : (
        <div className="p4BoardGrid">
          {COLUMNS.map(col => {
            const colTasks = byCol[col.key] || []
            return (
              <div key={col.key} className="p4BoardColumn" style={{ padding: 14, minHeight: 240 }}>
                <div className="p4BoardColumnHeader" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: col.color }}>{col.icon}</span>
                  <span style={{ fontWeight: 900, fontSize: 13, color: 'var(--text)' }}>{col.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, background: col.color + '18', color: col.color }}>{colTasks.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {colTasks.map(task => {
                    const signal = buildTaskSignal(task, loadByUser)
                    const pColor = PRIORITY_COLOR[task.priority || ''] || 'transparent'
                    return (
                      <div key={task.id} className="p4BoardCard" onClick={() => setSelectedTaskId(task.id)} style={{ padding: '12px', border: '1px solid var(--border)', position: 'relative', cursor: 'pointer' }}>
                        {task.priority && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: pColor, borderRadius: '18px 18px 0 0' }} />}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 7, paddingTop: task.priority ? 5 : 0 }}>
                          <div style={{ fontWeight: 850, fontSize: 13, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>{task.title}</div>
                          <span className={signalBadgeClass(signal.level)}>{signal.score}%</span>
                        </div>
                        {signal.needsAttention && <div style={{ color: '#f97316', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>⚠ {signal.note}</div>}
                        {signal.loadNote && <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 750, marginBottom: 6 }}>⚠ {signal.loadNote}</div>}
                        {canDrag && <select value={task.status} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); statusMutation.mutate({ id: task.id, status: e.target.value }) }} style={{ width: '100%', fontSize: 11, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '5px 7px', marginBottom: 7 }}>{COLUMNS.filter(c => c.key !== 'overdue').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {task.category_name && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: (task.category_color || '#818cf8') + '20', color: task.category_color || '#818cf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{task.category_name}</span>}
                          <DueLabel iso={task.due_date} />
                        </div>
                        {(task.assigned_to_name || (task.message_count || 0) > 0) && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                          {task.assigned_to_name && <><div style={{ width: 18, height: 18, borderRadius: 6, background: hashColor(task.assigned_to_name) + '30', color: hashColor(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>{task.assigned_to_name.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()}</div><span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.assigned_to_name}</span></>}
                          {(task.message_count || 0) > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto', flexShrink: 0 }}>💬 {task.message_count}</span>}
                        </div>}
                      </div>
                    )
                  })}
                  {colTasks.length === 0 && <div className="p4BoardDropEmpty" style={{ padding: '24px 12px', textAlign: 'center', border: `2px dashed ${col.color}28`, borderRadius: 14, color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>No tasks</div>}
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
