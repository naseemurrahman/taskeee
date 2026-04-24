import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiUpload, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { Link, Navigate } from 'react-router-dom'
import { Camera, MessageCircle } from 'lucide-react'
import { manualStatusOptionsForRole } from '../../lib/taskStatusTransitions'
import { Select } from '../../components/ui/Select'

type TaskRow = {
  id: string
  title: string
  status: string
  priority?: string
  due_date?: string | null
  category_name?: string | null
  photo_count?: string | number | null
}

type TaskDetail = TaskRow & {
  description?: string | null
  assigned_to?: string | null
  assigned_to_name?: string | null
}

type TimelineEvent = {
  id: string
  event_type: string
  to_status?: string | null
  note?: string | null
  created_at: string
  actor_name?: string | null
}

type TaskPhoto = {
  id: string
  ai_status?: string | null
  ai_confidence?: number | null
  created_at: string
  original_filename?: string | null
  uploaded_by_name?: string | null
}

type TaskMessage = {
  id: string
  body: string
  created_at: string
  sender_name?: string | null
  sender_id: string
}

async function fetchMyTasks(status: string) {
  const qs = new URLSearchParams({ mine: 'true', limit: '100', page: '1' })
  if (status && status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ tasks?: TaskRow[] }>(`/api/v1/tasks?${qs.toString()}`)
  return data.tasks || []
}

async function fetchTaskDetail(taskId: string) {
  return await apiFetch<{
    task: TaskDetail
    timeline: TimelineEvent[]
    photos: TaskPhoto[]
  }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
}

async function fetchMessages(taskId: string) {
  return await apiFetch<{ messages: TaskMessage[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/messages`)
}

const STATUS_FILTER: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'ai_reviewing', label: 'AI reviewing' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'ai_approved', label: 'AI approved' },
  { key: 'ai_rejected', label: 'AI rejected' },
  { key: 'completed', label: 'Done' },
]

function formatDue(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function MyTasksPage() {
  const me = getUser()
  if (me?.role === 'hr' || me?.role === 'admin') {
    return <Navigate to="/app/dashboard" replace />
  }
  const qc = useQueryClient()
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [manualStatus, setManualStatus] = useState('')

  const listQ = useQuery({
    queryKey: ['tasks', 'mine', status],
    queryFn: () => fetchMyTasks(status),
  })

  const detailQ = useQuery({
    queryKey: ['tasks', 'detail', selectedId],
    queryFn: () => fetchTaskDetail(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (q) => {
      const st = q.state.data?.task?.status
      return st === 'ai_reviewing' ? 4000 : false
    },
  })

  const msgQ = useQuery({
    queryKey: ['tasks', 'messages', selectedId],
    queryFn: () => fetchMessages(selectedId!),
    enabled: !!selectedId,
  })

  const task = detailQ.data?.task
  const photos = detailQ.data?.photos || []
  const timeline = detailQ.data?.timeline || []

  useEffect(() => {
    if (task?.status) setManualStatus(task.status)
  }, [task?.id, task?.status])

  const aiTimeline = useMemo(
    () =>
      timeline.filter((e) =>
        ['ai_review_complete', 'ai_task_review_complete', 'photo_uploaded', 'ai_review_failed', 'ai_task_review_failed'].includes(
          e.event_type
        )
      ),
    [timeline]
  )

  const isAssignee = !!(me?.id && task?.assigned_to && task.assigned_to === me.id)
  const canManageStatus = !!me?.role && ['supervisor', 'manager', 'director', 'admin'].includes(me.role)

  const manualStatusChoices = useMemo(() => {
    if (!task || !canManageStatus) return []
    return manualStatusOptionsForRole(me?.role, task.status)
  }, [task, canManageStatus, me?.role])

  const uploadM = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.set('taskId', selectedId!)
      fd.set('photo', file)
      return await apiUpload<{ message?: string }>(`/api/v1/photos/upload`, fd)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'detail', selectedId] }),
      ])
    },
  })

  const statusM = useMutation({
    mutationFn: async (next: string) => {
      return await apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/status`, {
        method: 'PATCH',
        json: { status: next },
      })
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'detail', selectedId] }),
      ])
    },
  })

  const aiTaskM = useMutation({
    mutationFn: async () => apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/ai-review`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'detail', selectedId] }),
      ])
    },
  })

  const postMsgM = useMutation({
    mutationFn: async (body: string) => {
      return await apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/messages`, {
        method: 'POST',
        json: { body },
      })
    },
    onSuccess: async () => {
      setComment('')
      await qc.invalidateQueries({ queryKey: ['tasks', 'messages', selectedId] })
    },
  })

  const tasks = listQ.data || []

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>
              My Tasks
            </div>
            <div className="pageHeaderCardSub">View tasks assigned to you. Submit work for approval, track your performance score, add comments, and upload files.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>✅</span> Personal tasks</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>💬</span> Comments & files</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📤</span> Submit for review</span>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>My tasks</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>
              Work assigned to you by project (category). Upload photos for ML review, discuss with your team, and track status.
            </div>
          </div>
          <Link className="btn btnGhost" to="/app/tasks" style={{ textDecoration: 'none' }}>
            All org tasks
          </Link>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 900 }}>STATUS</span>
          <div style={{ width: 180 }}>
            <Select value={status} onChange={setStatus}
              options={STATUS_FILTER.map(s => ({ value: s.key, label: s.label }))}
            />
          </div>
        </div>
      </div>

      <div className="myTasksLayout">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {listQ.isLoading ? <div style={{ padding: 16, color: 'var(--text2)' }}>Loading…</div> : null}
          {listQ.isError ? <div className="alert alertError" style={{ margin: 12 }}>Failed to load tasks.</div> : null}
          {!listQ.isLoading && tasks.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--text2)' }}>No tasks assigned to you for this filter.</div>
          ) : null}
          <div className="myTasksList">
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`myTasksListItem ${selectedId === t.id ? 'myTasksListItemActive' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="myTasksListTitle">{t.title}</div>
                <div className="myTasksListMeta">
                  {t.category_name ? <span className="pill pillMuted">{t.category_name}</span> : <span className="pill pillMuted">Project</span>}
                  <span className="pill">{t.status}</span>
                </div>
                {t.due_date ? <div className="myTasksListDue">Due {formatDue(t.due_date)}</div> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          {!selectedId ? (
            <div style={{ color: 'var(--text2)' }}>Select a task to upload photos, read AI results, comment, and update status.</div>
          ) : detailQ.isLoading ? (
            <div style={{ color: 'var(--text2)' }}>Loading task…</div>
          ) : detailQ.isError ? (
            <div className="alert alertError">Could not load this task.</div>
          ) : task ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 950, letterSpacing: '-0.35px', fontSize: '1.1rem' }}>{task.title}</div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span className="pill pillMuted">Project · {task.category_name || '—'}</span>
                  <span className="pill">{task.status}</span>
                  {task.priority ? <span className="pill pillMuted">{task.priority}</span> : null}
                  {task.due_date ? <span className="pill pillMuted">Due {formatDue(task.due_date)}</span> : null}
                </div>
                {task.description ? (
                  <p style={{ margin: '12px 0 0', color: 'var(--text2)', lineHeight: 1.5 }}>{task.description}</p>
                ) : null}
              </div>

              <div className="miniCard" style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Camera size={16} aria-hidden />
                  Photos &amp; ML review
                </div>
                <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13, lineHeight: 1.45 }}>
                  Upload an image while the task is actionable. The vision model scores it against the project threshold; the task moves to{' '}
                  <strong>ai_reviewing</strong>, then <strong>ai_approved</strong> / <strong>ai_rejected</strong> (or manual follow-up). PDFs
                  upload as evidence without vision review.
                </p>
                {isAssignee ? (
                  <label className="btn btnGhost" style={{ width: 'fit-content' }}>
                    {uploadM.isPending ? 'Uploading…' : 'Upload attachment'}
                    <input
                      type="file"
                      accept=".csv,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,text/csv,application/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
                      style={{ display: 'none' }}
                      disabled={uploadM.isPending}
                      onChange={(ev) => {
                        const f = ev.target.files?.[0]
                        ev.target.value = ''
                        if (f) uploadM.mutate(f)
                      }}
                    />
                  </label>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>Only the assignee can upload photos for this task.</div>
                )}
                {uploadM.isError ? (
                  <div className="alert alertError">
                    {uploadM.error instanceof ApiError ? uploadM.error.message : 'Upload failed.'}
                  </div>
                ) : null}

                {photos.length ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                    {photos.map((p) => (
                      <li key={p.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 800 }}>{p.original_filename || 'Photo'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                          {p.uploaded_by_name || 'You'} · {new Date(p.created_at).toLocaleString()}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          ML: <strong>{p.ai_status || '—'}</strong>
                          {p.ai_confidence != null ? ` · confidence ${(Number(p.ai_confidence) * 100).toFixed(1)}%` : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>No uploads yet.</div>
                )}
              </div>

              {aiTimeline.length ? (
                <div className="miniCard" style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 900 }}>Recent AI activity</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', fontSize: 13 }}>
                    {aiTimeline.slice(-6).map((e) => (
                      <li key={e.id} style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text)' }}>{e.event_type}</span>
                        {e.to_status ? ` → ${e.to_status}` : ''}: {e.note || '—'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="miniCard" style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontWeight: 900 }}>Text AI review</div>
                <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
                  When status is <strong>submitted</strong>, the assignee can send the whole task for a text-based AI check (separate from photo
                  ML).
                </p>
                {isAssignee && task.status === 'submitted' ? (
                  <button type="button" className="btn btnPrimary" disabled={aiTaskM.isPending} onClick={() => aiTaskM.mutate()}>
                    {aiTaskM.isPending ? 'Starting…' : 'Run text AI review'}
                  </button>
                ) : null}
                {aiTaskM.isError ? (
                  <div className="alert alertError">
                    {aiTaskM.error instanceof ApiError ? aiTaskM.error.message : 'AI review failed.'}
                  </div>
                ) : null}
              </div>

              {canManageStatus ? (
                <div className="miniCard" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>Manual status (manager / lead)</div>
                  <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
                    Only transitions allowed by your role and the current state are listed. Directors and admins can set any valid status.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <div style={{ width: 240 }}>
                      <Select
                        value={manualStatusChoices.includes(manualStatus) ? manualStatus : task.status}
                        onChange={setManualStatus}
                        options={manualStatusChoices.map(s => ({
                          value: s,
                          label: s === task.status ? `${s} (current)` : s,
                        }))}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btnPrimary"
                      disabled={statusM.isPending || !manualStatus || manualStatus === task.status}
                      onClick={() => statusM.mutate(manualStatus)}
                    >
                      {statusM.isPending ? 'Saving…' : 'Apply'}
                    </button>
                  </div>
                  {statusM.isError ? (
                    <div className="alert alertError">
                      {statusM.error instanceof ApiError ? statusM.error.message : 'Update failed.'}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="miniCard" style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MessageCircle size={16} aria-hidden />
                  Team comments
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 8 }}>
                  {msgQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading messages…</div> : null}
                  {(msgQ.data?.messages || []).map((m) => (
                    <div key={m.id} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {m.sender_name || 'User'} · {new Date(m.created_at).toLocaleString()}
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                  ))}
                  {!msgQ.isLoading && (msgQ.data?.messages || []).length === 0 ? (
                    <div style={{ color: 'var(--text2)', fontSize: 13 }}>No messages yet. Start the thread below.</div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    style={{ flex: '1 1 220px', minWidth: 0 }}
                    placeholder="Write a comment…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={8000}
                  />
                  <button
                    type="button"
                    className="btn btnPrimary"
                    disabled={postMsgM.isPending || !comment.trim()}
                    onClick={() => postMsgM.mutate(comment.trim())}
                  >
                    {postMsgM.isPending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {postMsgM.isError ? (
                  <div className="alert alertError">
                    {postMsgM.error instanceof ApiError ? postMsgM.error.message : 'Message failed.'}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
