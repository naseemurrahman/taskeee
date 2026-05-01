import { useState, useRef, useEffect, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, MessageCircle } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { useToast } from '../ui/ToastSystem'

type Task = {
  id: string; title: string; status: string; priority?: string | null
  due_date?: string | null; description?: string | null
  assigned_to?: string | null; assigned_to_name?: string | null
  assigned_by?: string | null; assigned_by_name?: string | null
  category_name?: string | null; category_color?: string | null
  created_at?: string; updated_at?: string
}
type Message = { id: string; body: string; created_at: string; sender_name?: string | null; sender_id: string }
type TimelineItem = { id: string; event_type: string; note?: string | null; actor_name?: string | null; created_at: string }
type TaskPhoto = { id: string; file_url?: string | null; photo_url?: string | null; created_at: string; uploaded_by_name?: string | null }
type AssignableUser = { id: string; name: string; role?: string }

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:          { label: 'Pending',     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  in_progress:      { label: 'In Progress', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  submitted:        { label: 'Submitted',   color: '#38bdf8', bg: 'rgba(56,189,248,0.12)'  },
  manager_approved: { label: 'Approved',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  manager_rejected: { label: 'Rejected',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  completed:        { label: 'Completed',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  overdue:          { label: 'Overdue',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  cancelled:        { label: 'Cancelled',   color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
}

const PRIORITY_META: Record<string, { color: string; icon: ReactNode }> = {
  low:      { color: '#38bdf8', icon: <ArrowDown size={12} /> },
  medium:   { color: '#8B5CF6', icon: <ArrowRight size={12} /> },
  high:     { color: '#f97316', icon: <ArrowUp size={12} /> },
  critical: { color: '#ef4444', icon: <AlertTriangle size={12} /> },
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function initials(name?: string | null) {
  if (!name) return '?'
  return name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
}

function hashColor(s: string) {
  let h = 0; for (const c of s) h = (h << 5) - h + c.charCodeAt(0)
  return `hsl(${Math.abs(h) % 360},55%,55%)`
}

export function TaskDetailDrawer({
  taskId,
  onClose,
  initialTab = 'details',
}: { taskId: string | null; onClose: () => void; initialTab?: 'details' | 'comments' }) {
  const me = getUser()
  const qc = useQueryClient()
  const canManage = canCreateTasksAndProjects(me?.role)
  const { success: toastSuccess, error: toastError } = useToast()
  const [comment, setComment] = useState('')
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'files'>(initialTab as 'details' | 'comments' | 'files')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !taskId) return
    setUploading(true); setUploadError(null)
    try {
      const form = new FormData()
      form.append('photo', file)
      form.append('file', file)
      form.append('taskId', taskId)
      const API = (import.meta as any).env?.VITE_API_BASE_URL || ''
      const token = localStorage.getItem('tf_access_token') || sessionStorage.getItem('tf_access_token') || ''
      const res = await fetch(`${API}/api/v1/photos/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed') }
      qc.invalidateQueries({ queryKey: ['task-detail', taskId] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally { setUploading(false) }
  }

  const taskQ = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => apiFetch<{ task: Task; timeline?: TimelineItem[]; photos?: TaskPhoto[] }>(`/api/v1/tasks/${taskId}`),
    enabled: !!taskId,
    staleTime: 30_000,
  })
  const task = taskQ.data?.task
  const timeline = taskQ.data?.timeline || []
  const photos = taskQ.data?.photos || []

  const assigneesQ = useQuery({
    queryKey: ['tasks', 'assignable-users'],
    queryFn: () => apiFetch<{ users: AssignableUser[] }>('/api/v1/tasks/assignable-users').then(d => d.users || []),
    enabled: !!taskId && canManage,
    staleTime: 60_000,
  })

  const messagesQ = useQuery({
    queryKey: ['task-messages', taskId],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/api/v1/tasks/${taskId}/messages`).then(d => d.messages || []),
    enabled: !!taskId,
    refetchInterval: 15_000,
  })
  const messages = messagesQ.data || []

  useEffect(() => {
    if (activeTab === 'comments') setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [messages, activeTab])

  useEffect(() => {
    if (taskId) setActiveTab(initialTab)
  }, [taskId, initialTab])

  const commentM = useMutation({
    mutationFn: (body: string) => apiFetch(`/api/v1/tasks/${taskId}/messages`, { method: 'POST', json: { body } }),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['task-messages', taskId] })
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    },
    onError: (err: any) => {
      toastError('Comment failed', err instanceof ApiError ? err.message : 'Failed to send comment')
    }
  })

  const statusM = useMutation({
    mutationFn: (status: string) => apiFetch(`/api/v1/tasks/${taskId}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: (_data, status) => {
      qc.invalidateQueries({ queryKey: ['task-detail', taskId] })
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const label = STATUS_META[status]?.label || status
      toastSuccess('Status updated', `Task marked as ${label}`)
    },
    onError: (err: any) => {
      toastError('Update failed', err instanceof ApiError ? err.message : 'Could not update status')
    }
  })

  const detailsM = useMutation({
    mutationFn: (payload: { assignedTo?: string | null; dueDate?: string | null }) =>
      apiFetch(`/api/v1/tasks/${taskId}/details`, { method: 'PATCH', json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-detail', taskId] })
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toastSuccess('Task updated', 'Changes saved successfully')
    },
    onError: (err: any) => {
      toastError('Save failed', err instanceof ApiError ? err.message : 'Could not save changes')
    }
  })

  function sendComment() {
    const t = comment.trim()
    if (!t || commentM.isPending) return
    commentM.mutate(t)
  }

  // Keyboard shortcut: Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!taskId) return null

  const statusMeta = STATUS_META[task?.status || ''] || { label: task?.status || '', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' }
  const priorityMeta = PRIORITY_META[task?.priority || '']

  // Valid next statuses for current user/role
  const transitions: string[] = canManage
    ? { pending: ['in_progress','completed','cancelled'], in_progress: ['submitted','completed','cancelled','pending'], submitted: ['manager_approved','manager_rejected','completed'], manager_approved: ['completed'], manager_rejected: ['in_progress','pending'], overdue: ['in_progress','completed'], cancelled: ['pending'] }[task?.status || ''] || []
    : { pending: ['in_progress'], in_progress: ['submitted','pending'], submitted: ['in_progress'], manager_rejected: ['in_progress'] }[task?.status || ''] || []

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9990, backdropFilter: 'blur(2px)' }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: typeof window !== 'undefined' && window.innerWidth <= 600 ? '100vw' : 'min(520px, 100vw)', zIndex: 9991,
        background: 'var(--bg1)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-16px 0 48px rgba(0,0,0,0.25)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {taskQ.isLoading ? (
              <div className="skeleton" style={{ height: 22, width: '70%', borderRadius: 8 }} />
            ) : (
              <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.3px', color: 'var(--text)', lineHeight: 1.3 }}>{task?.title}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {task && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.color}33` }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusMeta.color }} />
                  {statusMeta.label}
                </span>
              )}
              {task?.priority && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: (priorityMeta?.color || '#9ca3af') + '18', color: priorityMeta?.color || '#9ca3af', border: `1px solid ${priorityMeta?.color || '#9ca3af'}33` }}>
                  {priorityMeta?.icon} {task.priority}
                </span>
              )}
              {task?.category_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: (task.category_color || '#818cf8') + '18', color: task.category_color || '#818cf8', border: `1px solid ${(task.category_color || '#818cf8')}28` }}>
                  {task.category_name}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {[
            { key: 'details', label: 'Details' },
            { key: 'comments', label: 'Comments', badge: messages.length },
            { key: 'files', label: 'Files', badge: photos.length },
          ].map(({ key, label, badge }) => (
            <button key={key} onClick={() => setActiveTab(key as any)} style={{
              padding: '10px 12px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 800,
              color: activeTab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: `2px solid ${activeTab === key ? 'var(--brand)' : 'transparent'}`,
              display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.15s',
            }}>
              {label}
              {(badge || 0) > 0 && (
                <span style={{ fontSize: 9, fontWeight: 900, padding: '1px 5px', borderRadius: 999, background: activeTab === key ? 'var(--brandDim)' : 'var(--bg2)', color: activeTab === key ? 'var(--brand)' : 'var(--muted)' }}>{badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {activeTab === 'details' ? (
            <div style={{ display: 'grid', gap: 18 }}>

              {/* Assignee + Due */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Assigned To</div>
                  {task?.assigned_to_name ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: hashColor(task.assigned_to_name) + '25', color: hashColor(task.assigned_to_name), display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>
                        {initials(task.assigned_to_name)}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{task.assigned_to_name}</span>
                    </div>
                  ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Unassigned</span>}
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Due Date</div>
                  {task?.due_date ? (
                    <div style={{ fontSize: 13, fontWeight: 800, color: new Date(task.due_date) < new Date() && !['completed','manager_approved'].includes(task?.status || '') ? '#ef4444' : 'var(--text)' }}>
                      {new Date(task.due_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>No due date</span>}
                </div>
              </div>

              {canManage && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Change Assignee</div>
                    <select
                      value={task?.assigned_to || ''}
                      onChange={e => detailsM.mutate({ assignedTo: e.target.value || null })}
                      disabled={detailsM.isPending || assigneesQ.isLoading}
                      style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg1)', color: 'var(--text)', padding: '8px 10px' }}
                    >
                      <option value="">Unassigned</option>
                      {(assigneesQ.data || []).map(u => (
                        <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Change Due Date</div>
                    <input
                      type="date"
                      value={task?.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : ''}
                      onChange={e => detailsM.mutate({ dueDate: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null })}
                      disabled={detailsM.isPending}
                      style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg1)', color: 'var(--text)', padding: '8px 10px' }}
                    />
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Description</div>
                {taskQ.isLoading ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {[70, 90, 50].map((w, i) => <div key={i} className="skeleton" style={{ height: 14, width: w + '%', borderRadius: 6 }} />)}
                  </div>
                ) : task?.description ? (
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text2)', whiteSpace: 'pre-wrap', background: 'var(--bg2)', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)' }}>
                    {task.description}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', padding: '10px 0' }}>No description provided.</div>
                )}
              </div>

              {/* Status Change */}
              {transitions.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Change Status</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {transitions.map(s => {
                      const meta = STATUS_META[s] || { label: s.replace(/_/g,' '), color: '#9ca3af', bg: '' }
                      return (
                        <button key={s} onClick={() => statusM.mutate(s)} disabled={statusM.isPending}
                          style={{ padding: '6px 14px', borderRadius: 999, border: `1.5px solid ${meta.color}44`, background: meta.bg, color: meta.color, fontSize: 12, fontWeight: 800, cursor: 'pointer', transition: 'all 0.12s', opacity: statusM.isPending ? 0.6 : 1 }}>
                          → {meta.label}
                        </button>
                      )
                    })}
                  </div>
                  {statusM.isError && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{statusM.error instanceof ApiError ? statusM.error.message : 'Failed to update status'}</div>}
                </div>
              )}

              {/* Metadata */}
              {task && (
                <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Details</div>
                  {[
                    { label: 'Assigned by', value: task.assigned_by_name || '—' },
                    { label: 'Created', value: task.created_at ? timeAgo(task.created_at) : '—' },
                    { label: 'Updated', value: task.updated_at ? timeAgo(task.updated_at) : '—' },
                    { label: 'Task ID', value: task.id.slice(0, 8) + '…' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 12 }}>
                      <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
                      <span style={{ color: 'var(--text2)', fontWeight: 700, textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Attachments */}
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Attachments</div>
                {photos.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No attachments uploaded yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {photos.map(photo => {
                      const url = photo.file_url || photo.photo_url
                      return (
                        <a key={photo.id} href={url || '#'} target="_blank" rel="noreferrer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text2)' }}>
                          <span style={{ fontSize: 12 }}>{photo.uploaded_by_name || 'Unknown'} · {timeAgo(photo.created_at)}</span>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Open</span>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Status Timeline */}
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Status History Timeline</div>
                {timeline.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No timeline events yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {timeline.slice().reverse().map(item => (
                      <div key={item.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{item.note || item.event_type.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.actor_name || 'System'} · {timeAgo(item.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'files' ? (
            /* Files Tab */
            <div style={{ display: 'grid', gap: 12 }}>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                style={{ padding: '14px', borderRadius: 12, border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text2)', cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
                {uploading
                  ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 0.8s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg> Uploading...</>
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload file or evidence</>
                }
              </button>
              {uploadError && <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>⚠ {uploadError}</div>}
              <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Images, PDFs, documents • Manager notified on upload</div>
              {photos.length === 0
                ? <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)' }}><div style={{ fontSize: 28 }}>📎</div><div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>No files yet</div></div>
                : photos.map(ph => {
                    const url = ph.file_url || ph.photo_url
                    return (
                      <a key={ph.id} href={url || '#'} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', textDecoration: 'none', background: 'var(--bg2)' }}>
                        <span style={{ fontSize: 20 }}>{(ph as any).mime_type?.startsWith('image/') ? '🖼' : '📄'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(ph as any).original_filename || 'Attachment'}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ph.uploaded_by_name || 'Unknown'} · {timeAgo(ph.created_at)}</div>
                        </div>
                      </a>
                    )
                  })
              }
            </div>
          ) : (
            /* Comments Tab */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%' }}>
              {messagesQ.isLoading ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />)}
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
                  <div style={{ marginBottom: 8, display: 'grid', placeItems: 'center' }}>
                    <MessageCircle size={24} />
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text2)' }}>No comments yet</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Start the conversation below</div>
                </div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.sender_id === me?.id
                  const color = hashColor(msg.sender_name || msg.sender_id)
                  return (
                    <div key={msg.id} style={{ display: 'flex', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: color + '25', color, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900, flexShrink: 0, border: `1.5px solid ${color}40` }}>
                        {initials(msg.sender_name)}
                      </div>
                      <div style={{ maxWidth: '75%' }}>
                        <div style={{ padding: '10px 14px', borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: isMe ? 'var(--brandDim)' : 'var(--bg2)', border: `1px solid ${isMe ? 'var(--brandBorder)' : 'var(--border)'}`, fontSize: 13, lineHeight: 1.5, color: 'var(--text)', wordBreak: 'break-word' }}>
                          {msg.body}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, textAlign: isMe ? 'right' : 'left', fontWeight: 600 }}>
                          {isMe ? 'You' : msg.sender_name} · {timeAgo(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Comment Input (always visible when comments tab) */}
        {activeTab === 'comments' && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--bg1)' }}>
            <div style={{ flex: 1, borderRadius: 14, border: '1.5px solid var(--border)', background: 'var(--bg2)', overflow: 'hidden', transition: 'border-color 0.15s' }}
              onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--brandBorder)')}
              onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
              <textarea ref={textRef} value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment() } }}
                placeholder="Add a comment… (Enter to send, Shift+Enter for newline)"
                style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', resize: 'none', minHeight: 40, maxHeight: 120, overflowY: 'auto', boxSizing: 'border-box', display: 'block' }}
                rows={1}
              />
            </div>
            <button onClick={sendComment} disabled={!comment.trim() || commentM.isPending}
              style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'var(--brand)', color: '#1a1d2e', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 0.15s', opacity: !comment.trim() || commentM.isPending ? 0.45 : 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  )
}
