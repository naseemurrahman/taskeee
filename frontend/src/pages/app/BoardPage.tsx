import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { getAllowedNextStatuses } from '../../lib/taskStatusTransitions'
import { getUser } from '../../state/auth'

type Task = {
  id: string
  title: string
  status: string
  priority?: string
  category_name?: string | null
}

type TasksResponse = { tasks?: Task[]; rows?: Task[] }

async function fetchTasks() {
  const data = await apiFetch<TasksResponse>(`/api/v1/tasks?limit=200&page=1`)
  return (data.tasks || data.rows || []) as Task[]
}

async function updateStatus(input: { taskId: string; status: string }) {
  return await apiFetch(`/api/v1/tasks/${encodeURIComponent(input.taskId)}/status`, {
    method: 'PATCH',
    json: { status: input.status },
  })
}

const COLUMNS: Array<{ key: string; title: string }> = [
  { key: 'pending', title: 'To do' },
  { key: 'in_progress', title: 'In progress' },
  { key: 'submitted', title: 'Submitted' },
  { key: 'completed', title: 'Done' },
]

/** Map workflow statuses to the board column used for grouping and move targets */
function boardColumnKey(status: string): string {
  if (COLUMNS.some((c) => c.key === status)) return status
  return 'pending'
}

export function BoardPage() {
  const me = getUser()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['tasks', 'board'], queryFn: fetchTasks })
  const tasks = useMemo(() => q.data || [], [q.data])
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: updateStatus,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to update task.')
    },
  })

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const c of COLUMNS) map[c.key] = []
    for (const t of tasks) {
      const k = boardColumnKey(t.status)
      map[k].push(t)
    }
    return map
  }, [tasks])

  return (
    <div className="boardShell">
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Board
            </div>
            <div className="pageHeaderCardSub">Kanban-style task board. Drag tasks between columns (Pending → In Progress → Submitted → Approved → Completed) to update their status.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🗂️</span> Kanban view</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🔄</span> Drag to move status</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>⚡</span> Real-time updates</span>
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="alertV4 alertV4Error">{error}</div> : null}
      {q.isLoading ? <div style={{ color: 'var(--text2)', padding: '8px 0' }}>Loading…</div> : null}
      {q.isError ? <div className="alertV4 alertV4Error">Failed to load tasks.</div> : null}

      <div className="boardGrid">
        {COLUMNS.map((col) => (
          <div key={col.key} className="boardCol">
            <div className="boardColHead">
              <div className="boardColTitle">{col.title}</div>
              <div className="boardColCount">{grouped[col.key]?.length || 0}</div>
            </div>

            <div className="boardColBody">
              {(grouped[col.key] || []).map((t) => (
                <div key={t.id} className="boardCard">
                  <div className="boardCardTitle">{t.title}</div>
                  <div className="boardCardMeta">
                    {t.category_name ? <span className="pill pillMuted">{t.category_name}</span> : null}
                    <span className="pill">{t.status}</span>
                  </div>
                  <div className="boardCardActions">
                    {(() => {
                      const allowed = new Set(getAllowedNextStatuses(me?.role, t.status))
                      const colKey = boardColumnKey(t.status)
                      const moveCols = COLUMNS.filter((c) => c.key !== colKey && allowed.has(c.key)).slice(0, 2)
                      return moveCols.map((c) => (
                        <button
                          key={c.key}
                          className="btn btnGhost"
                          style={{ height: 36 }}
                          disabled={m.isPending}
                          onClick={() => m.mutate({ taskId: t.id, status: c.key })}
                        >
                          Move to {c.title}
                        </button>
                      ))
                    })()}
                  </div>
                </div>
              ))}
              {!q.isLoading && (grouped[col.key] || []).length === 0 ? (
                <div className="boardEmpty">No tasks.</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

