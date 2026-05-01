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

type WorkloadRow = { employee_id: string; employee_name?: string; open_tasks: number }

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

function loadTone(load: number, avg: number) {
  if (load <= Math.max(1, avg * 0.65)) return { label: 'Available', color: '#22c55e' }
  if (load <= Math.max(3, avg * 1.15)) return { label: 'Balanced', color: '#8B5CF6' }
  return { label: 'High load', color: '#f97316' }
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
  const [focusMode, setFocusMode] = useState(false)
  const [aiSort, setAiSort] = useState(true)

  const tasksQ = useQuery({ queryKey: ['tasks', 'board'], queryFn: () => fetchTasks(isEmployee), staleTime: 30_000, refetchInterval: 60_000 })
  const workloadQ = useQuery({ queryKey: ['analytics-workload', 'board'], queryFn: fetchWorkload, staleTime: 45_000 })
  const tasks = tasksQ.data || []
  const workloadRows = workloadQ.data || []
  const loadByUser = useMemo(() => new Map(workloadRows.map(w => [w.employee_id, Number(w.open_tasks || 0)])), [workloadRows])
  const avgLoad = workloadRows.length ? workloadRows.reduce((s, w) => s + Number(w.open_tasks || 0), 0) / workloadRows.length : 0

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchStatus(id, status),
    onError: (err: any) => { setBoardError(err?.message || 'Status update failed'); setTimeout(() => setBoardError(null), 8000) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
  })

  const intelligence = useMemo(() => {
    const scored = tasks.map(task => ({ task, signal: buildTaskSignal(task, loadByUser) }))
    const risky = scored.filter(item => item.signal.needsAttention)
    const topRisk = scored.slice().sort((a, b) => b.signal.score - a.signal.score).slice(0, 3)
    const overloaded = workloadRows.slice().sort((a, b) => Number(b.open_tasks || 0) - Number(a.open_tasks || 0)).slice(0, 4)
    const available = workloadRows.slice().sort((a, b) => Number(a.open_tasks || 0) - Number(b.open_tasks || 0)).slice(0, 4)
    const suggestions = topRisk
      .filter(item => item.task.assigned_to && item.signal.score >= 55)
      .slice(0, 3)
      .map((item, index) => {
        const eligibleTargets = available.filter(candidate => candidate.employee_id !== item.task.assigned_to)
        const target = eligibleTargets[index % Math.max(eligibleTargets.length, 1)]
        return {
          task: item.task.title,
          from: item.task.assigned_to_name || 'current owner',
          to: target?.employee_name || 'another lower-load teammate',
          score: item.signal.score,
          reason: item.signal.loadNote || item.signal.note,
        }
      })
      .filter(item => item.from !== item.to)
    return { scored, risky, topRisk, overloaded, available, suggestions }
  }, [tasks, loadByUser, workloadRows])

  const visibleTasks = useMemo(() => {
    let rows = intelligence.scored
    if (focusMode) rows = rows.filter(item => item.signal.needsAttention)
    if (aiSort) rows = rows.slice().sort((a, b) => b.signal.score - a.signal.score)
    return rows.map(item => item.task)
  }, [aiSort, focusMode, intelligence.scored])

  const byCol = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const task of visibleTasks) map[COLUMNS.find(c => c.key === task.status)?.key || 'pending'].push(task)
    return map
  }, [visibleTasks])

  const signalFor = (task: Task) => buildTaskSignal(task, loadByUser)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Intelligent Board</div>
            <div className="pageHeaderCardSub">Focus Mode, AI prioritization, workload heatmap, and safe reassignment suggestions.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} tasks</span>
              {focusMode && <span className="pageHeaderCardTag" style={{ color: '#f97316', background: 'rgba(249,115,22,0.10)', borderColor: 'rgba(249,115,22,0.24)' }}>Focus: {visibleTasks.length} risk tasks</span>}
              {intelligence.risky.length > 0 && <span className="pageHeaderCardTag" style={{ color: '#f97316', background: 'rgba(249,115,22,0.10)', borderColor: 'rgba(249,115,22,0.24)' }}>AI: {intelligence.risky.length} need attention</span>}
              {!canDrag && <span className="pageHeaderCardTag" style={{ color: '#9ca3af' }}>Read-only view</span>}
            </div>
          </div>
          {canManage && <button className="btn btnPrimary" onClick={() => setCreateOpen(true)}>Create Task</button>}
        </div>
      </div>

      <div className="chartV3" style={{ padding: 14, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={focusMode ? 'btn btnPrimary' : 'btn btnGhost'} onClick={() => setFocusMode(v => !v)}>Focus Mode</button>
            <button type="button" className={aiSort ? 'btn btnPrimary' : 'btn btnGhost'} onClick={() => setAiSort(v => !v)}>AI priority sort</button>
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 12, fontWeight: 750 }}>Avg workload: {avgLoad.toFixed(1)} open tasks/person</div>
        </div>

        <div className="grid3">
          <div className="miniCard">
            <div className="miniLabel">Highest risk</div>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {intelligence.topRisk.length === 0 ? <span style={{ color: 'var(--text2)', fontSize: 12 }}>No tasks yet.</span> : intelligence.topRisk.map(item => <div key={item.task.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><span style={{ fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.task.title}</span><span className={signalBadgeClass(item.signal.level)}>{item.signal.score}%</span></div>)}
            </div>
          </div>
          <div className="miniCard">
            <div className="miniLabel">Workload heatmap</div>
            <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
              {intelligence.overloaded.length === 0 ? <span style={{ color: 'var(--text2)', fontSize: 12 }}>No workload data yet.</span> : intelligence.overloaded.map(row => { const tone = loadTone(Number(row.open_tasks || 0), avgLoad); return <div key={row.employee_id} style={{ display: 'grid', gap: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 800 }}><span>{row.employee_name || 'Team member'}</span><span style={{ color: tone.color }}>{row.open_tasks} open · {tone.label}</span></div><div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, Number(row.open_tasks || 0) * 10)}%`, background: tone.color }} /></div></div> })}
            </div>
          </div>
          <div className="miniCard">
            <div className="miniLabel">Smart reassignment suggestions</div>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {intelligence.suggestions.length === 0 ? <span style={{ color: 'var(--text2)', fontSize: 12 }}>No reassignment pressure detected.</span> : intelligence.suggestions.map((s, i) => <div key={`${s.task}-${i}`} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}><strong style={{ color: 'var(--text)' }}>{s.task}</strong><br />Review {s.from} → {s.to}. {s.reason}</div>)}
            </div>
          </div>
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
                    const signal = signalFor(task)
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
                  {colTasks.length === 0 && <div className="p4BoardDropEmpty" style={{ padding: '24px 12px', textAlign: 'center', border: `2px dashed ${col.color}28`, borderRadius: 14, color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>{focusMode ? 'No risk tasks' : 'No tasks'}</div>}
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
