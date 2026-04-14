import { useQuery } from '@tanstack/react-query'
import { Modal } from '../Modal'
import { apiFetch, ApiError } from '../../lib/api'

export type ProjectDetailResponse = {
  project: {
    id: string
    name: string
    description?: string | null
    icon?: string | null
    color?: string | null
    is_active?: boolean
    created_at?: string
  }
  taskCounts: { byStatus: Record<string, number>; total: number }
  workers: Array<{ id: string; full_name: string | null; email?: string | null }>
  leaders: Array<{ id: string; full_name: string | null; email?: string | null }>
  recentThreads: Array<{
    id: string
    body: string
    created_at: string
    task_id: string
    sender_name: string | null
    task_title: string | null
  }>
  deadlineSummary?: {
    overdueCount: number
    dueWithin7Days: number
    nextDueAt: string | null
    latestDueAt: string | null
  }
  assigneeMetrics?: Array<{
    id: string
    name: string | null
    active: number
    completed: number
    overdue: number
    totalTasks: number
    performanceScore: number
  }>
}

async function fetchProjectDetail(projectId: string) {
  return await apiFetch<ProjectDetailResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}`)
}

function PersonList(props: { title: string; people: ProjectDetailResponse['workers']; empty: string }) {
  if (!props.people.length) {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{props.title}</div>
        <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 13 }}>{props.empty}</div>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{props.title}</div>
      <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {props.people.map((p) => (
          <li key={p.id} className="miniCard" style={{ padding: '8px 10px' }}>
            <div style={{ fontWeight: 800 }}>{p.full_name || p.email || p.id}</div>
            {p.email ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.email}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProjectDetailModal(props: {
  projectId: string | null
  onClose: () => void
  onOpenTasks?: () => void
}) {
  const detailQ = useQuery({
    queryKey: ['project', 'detail', props.projectId],
    queryFn: () => fetchProjectDetail(props.projectId!),
    enabled: !!props.projectId,
    retry: (n, err) => (err instanceof ApiError && err.status === 404 ? false : n < 2),
  })

  const title = detailQ.data?.project?.name || 'Project'
  const ds = detailQ.data?.deadlineSummary

  return (
    <Modal
      title={title}
      open={!!props.projectId}
      onClose={props.onClose}
      wide
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btnGhost btnSm" onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="btn btnPrimary btnSm" onClick={() => (props.onOpenTasks ? props.onOpenTasks() : props.onClose())}>
            Open tasks
          </button>
        </div>
      }
    >
        {detailQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading details…</div> : null}
        {detailQ.isError ? (
          <div className="alert alertError">
            {detailQ.error instanceof ApiError && detailQ.error.status === 404
              ? 'Project details returned “not found.” If you just updated the server, restart the backend and hard-refresh. Otherwise this category may be inactive or in another org.'
              : 'Could not load project details.'}
          </div>
        ) : null}
      {detailQ.data ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.5 }}>{detailQ.data.project.description || 'No description.'}</div>
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="pill pillMuted">{detailQ.data.taskCounts.total} tasks</span>
              {Object.entries(detailQ.data.taskCounts.byStatus).map(([st, n]) => (
                <span key={st} className="pill pillMuted">
                  {st}: {n}
                </span>
              ))}
            </div>
          </div>

          {ds ? (
            <div className="miniCard" style={{ padding: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Deadlines</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 13, color: 'var(--text2)' }}>
                <div>
                  <strong style={{ color: 'var(--text)' }}>Next open due:</strong>{' '}
                  {ds.nextDueAt ? new Date(ds.nextDueAt).toLocaleString() : '—'}
                </div>
                <div>
                  <strong style={{ color: 'var(--text)' }}>Latest due date (any task):</strong>{' '}
                  {ds.latestDueAt ? new Date(ds.latestDueAt).toLocaleDateString() : '—'}
                </div>
                <div>
                  Overdue in this project: <strong style={{ color: 'var(--text)' }}>{ds.overdueCount}</strong> · Due within 7 days (open):{' '}
                  <strong style={{ color: 'var(--text)' }}>{ds.dueWithin7Days}</strong>
                </div>
              </div>
            </div>
          ) : null}

          <PersonList title="Working on this project" people={detailQ.data.workers} empty="No assignees yet — tasks in this project will list people here." />
          <PersonList title="Leading / coordinating (assigned by)" people={detailQ.data.leaders} empty="No coordinators listed yet — appears when tasks have an assigner." />

          <div>
            <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Employee score (this project)</div>
            <div style={{ marginTop: 6, color: 'var(--text2)', fontSize: 12, lineHeight: 1.4 }}>
              Simple score from completion rate on tasks here, minus pressure from overdue items (0–100).
            </div>
            {!(detailQ.data.assigneeMetrics || []).length ? (
              <div style={{ marginTop: 8, color: 'var(--text2)', fontSize: 13 }}>No assignee data yet.</div>
            ) : (
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {(detailQ.data.assigneeMetrics || []).map((a) => (
                  <li key={a.id} className="miniCard" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900 }}>{a.name || a.id}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        Active {a.active} · Done {a.completed} · Overdue {a.overdue}
                      </div>
                    </div>
                    <span className="pill">{a.performanceScore}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent threads</div>
            <div style={{ marginTop: 8, color: 'var(--text2)', fontSize: 13, lineHeight: 1.45 }}>Latest comments on tasks linked to this project.</div>
            {!detailQ.data.recentThreads.length ? (
              <div style={{ marginTop: 8, color: 'var(--text2)', fontSize: 13 }}>No messages yet.</div>
            ) : (
              <ul
                style={{
                  margin: '10px 0 0',
                  padding: 0,
                  listStyle: 'none',
                  display: 'grid',
                  gap: 8,
                  maxHeight: 'min(360px, 42vh)',
                  overflowY: 'auto',
                }}
              >
                {detailQ.data.recentThreads.map((th) => (
                  <li key={th.id} className="miniCard" style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {th.sender_name || 'Someone'} · {new Date(th.created_at).toLocaleString()}
                      {th.task_title ? <span> · {th.task_title}</span> : null}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4 }}>{th.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
