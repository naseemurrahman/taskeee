import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { apiFetch, apiUpload, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { manualStatusOptionsForRole } from '../../lib/taskStatusTransitions'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/ToastSystem'
import { useRealtimeInvalidation } from '../../lib/socket'
import { KpiCard } from '../../components/ui/KpiCard'
import '../../my-tasks-pro.css'

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

type WorkspaceTab = 'overview' | 'evidence' | 'chat' | 'feedback' | 'activity'

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
  { key: 'submitted', label: 'Submitted' },
  { key: 'ai_reviewing', label: 'AI reviewing' },
  { key: 'ai_approved', label: 'AI approved' },
  { key: 'ai_rejected', label: 'AI rejected' },
  { key: 'completed', label: 'Done' },
]

const STATUS_META: Record<string, { label: string; tone: string; progress: number }> = {
  pending: { label: 'To do', tone: 'amber', progress: 12 },
  overdue: { label: 'Overdue', tone: 'red', progress: 18 },
  in_progress: { label: 'In progress', tone: 'violet', progress: 45 },
  submitted: { label: 'Submitted', tone: 'sky', progress: 68 },
  ai_reviewing: { label: 'AI reviewing', tone: 'sky', progress: 78 },
  ai_approved: { label: 'AI approved', tone: 'green', progress: 86 },
  manager_approved: { label: 'Approved', tone: 'green', progress: 90 },
  ai_rejected: { label: 'Needs changes', tone: 'red', progress: 54 },
  manager_rejected: { label: 'Needs changes', tone: 'red', progress: 50 },
  completed: { label: 'Completed', tone: 'green', progress: 100 },
}

const PRIORITY_META: Record<string, string> = {
  low: 'sky',
  medium: 'violet',
  high: 'orange',
  critical: 'red',
  urgent: 'red',
}

function statusMeta(status?: string) {
  return STATUS_META[status || ''] || { label: (status || 'Unknown').replace(/_/g, ' '), tone: 'muted', progress: 20 }
}

function formatDue(iso: string | null | undefined) {
  if (!iso) return ''
  const numeric = Number(iso)
  const d = !Number.isNaN(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function dueInfo(iso: string | null | undefined) {
  if (!iso) return { label: 'No due date', tone: 'muted', days: null as number | null }
  const numeric = Number(iso)
  const d = !Number.isNaN(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: 'No due date', tone: 'muted', days: null as number | null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'red', days }
  if (days === 0) return { label: 'Due today', tone: 'amber', days }
  if (days === 1) return { label: 'Due tomorrow', tone: 'amber', days }
  if (days < 7) return { label: `Due in ${days}d`, tone: 'sky', days }
  return { label: formatDue(iso), tone: 'muted', days }
}

function formatDateTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function nextTaskAction(status?: string) {
  if (!status || ['pending', 'overdue', 'manager_rejected', 'ai_rejected'].includes(status)) {
    return { status: 'in_progress', label: 'Start work' }
  }
  if (status === 'in_progress') return { status: 'submitted', label: 'Submit for review' }
  if (['ai_approved', 'manager_approved'].includes(status)) return { status: 'completed', label: 'Mark complete' }
  return null
}

function sanitizeEventLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}

export function MyTasksPage() {
  const me = getUser()
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  // Invalidate my task list whenever any task changes org-wide (catches reassignments)
  useRealtimeInvalidation({ tasks: true })
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview')
  const [comment, setComment] = useState('')
  const [feedback, setFeedback] = useState('')
  const [manualStatus, setManualStatus] = useState('')

  const listQ = useQuery({
    queryKey: ['tasks', 'mine', status],
    queryFn: () => fetchMyTasks(status),
    refetchInterval: 45_000,
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
    refetchInterval: selectedId ? 30_000 : false,
  })

  const task = detailQ.data?.task
  const photos = detailQ.data?.photos || []
  const timeline = detailQ.data?.timeline || []
  const messages = msgQ.data?.messages || []
  const currentStatusMeta = statusMeta(task?.status)
  const currentDue = dueInfo(task?.due_date)
  const quickAction = nextTaskAction(task?.status)
  const canEmployeeAct = !!task && (!!(me?.id && task.assigned_to && task.assigned_to === me.id) || ['employee', 'technician'].includes(me?.role || ''))

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

  const canManageStatus = !!me?.role && ['supervisor', 'manager', 'hr', 'director', 'admin'].includes(me.role)

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
      toastSuccess('Attachment uploaded', 'Evidence was added to this task.')
    },
    onError: (err) => toastError('Upload failed', (err as any)?.message || 'Could not upload attachment.'),
  })

  async function uploadSelectedFiles(files: FileList | null) {
    if (!files?.length) return
    const batch = Array.from(files).slice(0, 5)
    for (const file of batch) await uploadM.mutateAsync(file)
  }

  const statusM = useMutation({
    mutationFn: async (next: string) => {
      return await apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/status`, {
        method: 'PATCH',
        json: { status: next },
      })
    },
    onSuccess: async (_data, nextStatus) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'detail', selectedId] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
      toastSuccess('Status updated', `Task marked as "${String(nextStatus).replace(/_/g, ' ')}"`)
    },
    onError: (err) => toastError('Update failed', (err as any)?.message || 'Could not update status.'),
  })

  const aiTaskM = useMutation({
    mutationFn: async () => apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/ai-review`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
        qc.invalidateQueries({ queryKey: ['tasks', 'detail', selectedId] }),
      ])
      toastSuccess('AI review started', 'The AI is reviewing this task. Results will appear shortly.')
    },
    onError: (err) => toastError('AI review failed', (err as any)?.message || 'Could not start AI review.'),
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
    onError: (err) => toastError('Message failed', (err as any)?.message || 'Could not send message.'),
  })

  const feedbackM = useMutation({
    mutationFn: async (body: string) => {
      return await apiFetch(`/api/v1/tasks/${encodeURIComponent(selectedId!)}/messages`, {
        method: 'POST',
        json: { body: `[Feedback] ${body}` },
      })
    },
    onSuccess: async () => {
      setFeedback('')
      await qc.invalidateQueries({ queryKey: ['tasks', 'messages', selectedId] })
      toastSuccess('Feedback sent', 'Your note was added to the task conversation.')
    },
    onError: (err) => toastError('Feedback failed', (err as any)?.message || 'Could not send feedback.'),
  })

  const tasks = listQ.data || []
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) => [t.title, t.category_name, t.status, t.priority].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [tasks, search])

  const taskStats = useMemo(() => {
    const stats = { total: tasks.length, pending: 0, in_progress: 0, submitted: 0, done: 0, overdue: 0, dueSoon: 0 }
    for (const t of tasks) {
      const due = dueInfo(t.due_date)
      if (due.days != null && due.days < 0 && !['completed', 'manager_approved', 'ai_approved'].includes(t.status)) stats.overdue++
      if (due.days != null && due.days >= 0 && due.days <= 2 && !['completed', 'manager_approved', 'ai_approved'].includes(t.status)) stats.dueSoon++
      if (t.status === 'pending') stats.pending++
      else if (t.status === 'in_progress') stats.in_progress++
      else if (['submitted', 'ai_reviewing'].includes(t.status)) stats.submitted++
      else if (['completed', 'manager_approved', 'ai_approved'].includes(t.status)) stats.done++
    }
    return stats
  }, [tasks])

  const completionRate = taskStats.total ? Math.round((taskStats.done / taskStats.total) * 100) : 0
  const selectedIndex = filteredTasks.findIndex(t => t.id === selectedId)

  useEffect(() => {
    if (!selectedId && filteredTasks.length > 0) setSelectedId(filteredTasks[0].id)
    if (selectedId && filteredTasks.length > 0 && !filteredTasks.some(t => t.id === selectedId)) setSelectedId(filteredTasks[0].id)
  }, [selectedId, filteredTasks])

  useEffect(() => {
    setActiveTab('overview')
  }, [selectedId])

  return (
    <div className="myTasksProRoot">
      <div className="pageHeaderCard myTasksProHero">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <ClipboardCheck size={21} aria-hidden />
              My Tasks Workspace
            </div>
            <div className="pageHeaderCardSub">
              Manage your assigned work, submit evidence, chat with your team, request feedback, and track approval progress from one place.
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{taskStats.total} assigned</span>
              <span className="pageHeaderCardTag" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.22)' }}>{completionRate}% complete</span>
              {taskStats.overdue > 0 ? <span className="pageHeaderCardTag" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>{taskStats.overdue} overdue</span> : null}
            </div>
          </div>
        </div>
      </div>

      <section className="myTasksCommandCenter kpiStripStandard">
        <div className="myTasksProgressCard" style={{ '--kpi-color': '#6366f1' } as any}>
          <div>
            <div className="miniLabel">Personal Progress</div>
            <div className="myTasksProgressValue">{completionRate}%</div>
            <div className="myTasksMuted">{taskStats.done} done · {taskStats.in_progress + taskStats.pending + taskStats.submitted} active</div>
          </div>
          <div className="myTasksProgressRing" style={{ ['--pct' as any]: `${completionRate}%` }}><span>{completionRate}%</span></div>
        </div>
        <KpiCard label="To do" value={taskStats.pending} color="#06b6d4" icon={<Clock3 size={28} />} className="myTasksStatCard" />
        <KpiCard label="In progress" value={taskStats.in_progress} color="#a855f7" icon={<Activity size={28} />} className="myTasksStatCard" />
        <KpiCard label="Review" value={taskStats.submitted} color="#06b6d4" icon={<Sparkles size={28} />} className="myTasksStatCard" />
        <KpiCard label="Done" value={taskStats.done} color="#22c55e" icon={<CheckCircle2 size={28} />} className="myTasksStatCard" />
      </section>

      <section className="myTasksToolbar card">
        <div className="myTasksSearchBox">
          <Search size={16} aria-hidden />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task, project, status, priority…" />
        </div>
        <div className="myTasksFilterWrap">
          <span>Status</span>
          <Select value={status} onChange={setStatus} options={STATUS_FILTER.map(s => ({ value: s.key, label: s.label }))} />
        </div>
      </section>

      <div className="myTasksProLayout">
        <aside className="myTasksQueue card">
          <div className="myTasksPanelHead">
            <div>
              <h2>Task queue</h2>
              <p>{filteredTasks.length} visible tasks</p>
            </div>
            {taskStats.dueSoon > 0 ? <span className="myTasksToneBadge amber">{taskStats.dueSoon} due soon</span> : null}
          </div>

          {listQ.isLoading ? <div className="myTasksEmptyState">Loading assigned tasks…</div> : null}
          {listQ.isError ? <div className="alert alertError" style={{ margin: 12 }}>Failed to load tasks.</div> : null}
          {!listQ.isLoading && filteredTasks.length === 0 ? (
            <div className="myTasksEmptyState">
              <strong>No tasks found</strong>
              <span>Try changing the status filter or search terms.</span>
            </div>
          ) : null}

          <div className="myTasksProList">
            {filteredTasks.map((t, index) => {
              const meta = statusMeta(t.status)
              const due = dueInfo(t.due_date)
              const priorityTone = PRIORITY_META[(t.priority || '').toLowerCase()] || 'muted'
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`myTasksProItem ${selectedId === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="myTasksItemTop">
                    <span className={`myTasksStatusDot ${meta.tone}`} />
                    <strong>{t.title}</strong>
                    <small>#{index + 1}</small>
                  </div>
                  <div className="myTasksItemMeta">
                    <span className={`myTasksToneBadge ${meta.tone}`}>{meta.label}</span>
                    {t.priority ? <span className={`myTasksToneBadge ${priorityTone}`}>{t.priority}</span> : null}
                    <span className={`myTasksToneBadge ${due.tone}`}>{due.label}</span>
                  </div>
                  <div className="myTasksItemFooter">
                    <span>{t.category_name || 'No project'}</span>
                    {Number(t.photo_count || 0) > 0 ? <span><Paperclip size={12} /> {t.photo_count}</span> : null}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="myTasksWorkspace card">
          {!selectedId ? (
            <div className="myTasksEmptyState large">
              <ClipboardCheck size={36} />
              <strong>Select a task</strong>
              <span>Choose a task from the queue to manage evidence, comments, feedback, and status.</span>
            </div>
          ) : detailQ.isLoading ? (
            <div className="myTasksEmptyState large">Loading task workspace…</div>
          ) : detailQ.isError ? (
            <div className="alert alertError">Could not load this task.</div>
          ) : task ? (
            <div className="myTasksWorkspaceInner">
              <header className="myTasksDetailHero">
                <div className="myTasksDetailMain">
                  <div className="myTasksBreadcrumb">Task {selectedIndex >= 0 ? selectedIndex + 1 : ''} of {filteredTasks.length}</div>
                  <h2>{task.title}</h2>
                  <div className="myTasksDetailPills">
                    <span className={`myTasksToneBadge ${currentStatusMeta.tone}`}>{currentStatusMeta.label}</span>
                    <span className="myTasksToneBadge muted">Project · {task.category_name || '—'}</span>
                    {task.priority ? <span className={`myTasksToneBadge ${PRIORITY_META[(task.priority || '').toLowerCase()] || 'muted'}`}>{task.priority}</span> : null}
                    <span className={`myTasksToneBadge ${currentDue.tone}`}>{currentDue.label}</span>
                  </div>
                </div>
                <div className="myTasksTaskProgress">
                  <span>{currentStatusMeta.progress}%</span>
                  <div><i style={{ width: `${currentStatusMeta.progress}%` }} /></div>
                  <small>workflow progress</small>
                </div>
              </header>

              <div className="myTasksQuickActions">
                {quickAction && canEmployeeAct ? (
                  <button className="btn btnPrimary" disabled={statusM.isPending} onClick={() => statusM.mutate(quickAction.status)}>
                    {statusM.isPending ? 'Saving…' : quickAction.label}
                  </button>
                ) : null}
                <label className="btn btnGhost">
                  <UploadCloud size={15} />
                  {uploadM.isPending ? 'Uploading…' : 'Upload evidence'}
                  <input
                    type="file"
                    multiple
                    accept=".csv,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,text/csv,application/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
                    style={{ display: 'none' }}
                    disabled={uploadM.isPending || !canEmployeeAct}
                    onChange={async ev => {
                      const files = ev.target.files
                      ev.target.value = ''
                      await uploadSelectedFiles(files)
                    }}
                  />
                </label>
                {task.status === 'submitted' && canEmployeeAct ? (
                  <button className="btn btnGhost" disabled={aiTaskM.isPending} onClick={() => aiTaskM.mutate()}>
                    <Sparkles size={15} />
                    {aiTaskM.isPending ? 'Starting…' : 'Run AI review'}
                  </button>
                ) : null}
              </div>

              <nav className="myTasksTabs" aria-label="Task workspace sections">
                {([
                  ['overview', 'Overview'],
                  ['evidence', `Evidence ${photos.length ? `(${photos.length})` : ''}`],
                  ['chat', `Chat ${messages.length ? `(${messages.length})` : ''}`],
                  ['feedback', 'Feedback'],
                  ['activity', 'Activity'],
                ] as [WorkspaceTab, string][]).map(([key, label]) => (
                  <button key={key} type="button" className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>{label}</button>
                ))}
              </nav>

              {activeTab === 'overview' ? (
                <section className="myTasksTabPanel">
                  <div className="myTasksOverviewGrid">
                    <div className="myTasksInfoCard">
                      <h3>Brief</h3>
                      <p>{task.description || 'No detailed description was provided for this task.'}</p>
                    </div>
                    <div className="myTasksInfoCard">
                      <h3>Recommended next step</h3>
                      <p>{quickAction ? `Use “${quickAction.label}” when you are ready to move this task forward.` : 'This task is waiting on review or has already reached a final state.'}</p>
                    </div>
                    <div className="myTasksInfoCard">
                      <h3>Review status</h3>
                      <p>{aiTimeline.length ? `${aiTimeline.length} AI/evidence events recorded.` : 'No AI or evidence review activity yet.'}</p>
                    </div>
                  </div>
                  {canManageStatus ? (
                    <div className="myTasksManagerBox">
                      <div>
                        <strong>Manager status override</strong>
                        <span>Only transitions allowed by your role are listed.</span>
                      </div>
                      <div className="myTasksManagerControls">
                        <Select
                          value={manualStatusChoices.includes(manualStatus) ? manualStatus : task.status}
                          onChange={setManualStatus}
                          options={manualStatusChoices.map(s => ({ value: s, label: s === task.status ? `${s} (current)` : s }))}
                        />
                        <button className="btn btnPrimary" disabled={statusM.isPending || !manualStatus || manualStatus === task.status} onClick={() => statusM.mutate(manualStatus)}>
                          Apply
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeTab === 'evidence' ? (
                <section className="myTasksTabPanel">
                  <div className="myTasksEvidenceDrop">
                    <Camera size={24} />
                    <div>
                      <strong>Upload proof, reports, photos, PDFs, or sheets</strong>
                      <span>Images can trigger AI review. Documents are stored as evidence.</span>
                    </div>
                    <label className="btn btnPrimary">
                      Add files
                      <input
                        type="file"
                        multiple
                        accept=".csv,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,text/csv,application/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
                        style={{ display: 'none' }}
                        disabled={uploadM.isPending || !canEmployeeAct}
                        onChange={async ev => {
                          const files = ev.target.files
                          ev.target.value = ''
                          await uploadSelectedFiles(files)
                        }}
                      />
                    </label>
                  </div>
                  {uploadM.isError ? <div className="alert alertError">{uploadM.error instanceof ApiError ? uploadM.error.message : 'Upload failed.'}</div> : null}
                  <div className="myTasksEvidenceGrid">
                    {photos.length ? photos.map(p => (
                      <article key={p.id} className="myTasksEvidenceCard">
                        <Paperclip size={18} />
                        <div>
                          <strong>{p.original_filename || 'Attachment'}</strong>
                          <span>{p.uploaded_by_name || 'You'} · {formatDateTime(p.created_at)}</span>
                          <small>AI: {p.ai_status || 'not reviewed'}{p.ai_confidence != null ? ` · ${(Number(p.ai_confidence) * 100).toFixed(1)}% confidence` : ''}</small>
                        </div>
                      </article>
                    )) : <div className="myTasksEmptyState">No evidence has been uploaded for this task.</div>}
                  </div>
                </section>
              ) : null}

              {activeTab === 'chat' ? (
                <section className="myTasksTabPanel">
                  <div className="myTasksChatBox">
                    {msgQ.isLoading ? <div className="myTasksEmptyState">Loading messages…</div> : null}
                    {messages.length ? messages.map(m => (
                      <article key={m.id} className={`myTasksMessage ${m.sender_id === me?.id ? 'mine' : ''}`}>
                        <div><strong>{m.sender_name || 'User'}</strong><span>{formatDateTime(m.created_at)}</span></div>
                        <p>{m.body}</p>
                      </article>
                    )) : !msgQ.isLoading ? <div className="myTasksEmptyState">No messages yet. Start the conversation below.</div> : null}
                  </div>
                  <div className="myTasksComposer">
                    <MessageCircle size={17} />
                    <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Write a task update or question…" maxLength={8000} />
                    <button className="btn btnPrimary" disabled={postMsgM.isPending || !comment.trim()} onClick={() => postMsgM.mutate(comment.trim())}>
                      <Send size={15} /> Send
                    </button>
                  </div>
                </section>
              ) : null}

              {activeTab === 'feedback' ? (
                <section className="myTasksTabPanel">
                  <div className="myTasksFeedbackBox">
                    <AlertTriangle size={22} />
                    <div>
                      <strong>Request help or leave structured feedback</strong>
                      <p>Use this for blockers, clarification requests, completion notes, safety concerns, or manager feedback. It is stored in the task chat with a feedback label.</p>
                    </div>
                  </div>
                  <textarea className="myTasksFeedbackInput" value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Example: I need clarification on the acceptance criteria before submitting this task." maxLength={4000} />
                  <button className="btn btnPrimary" disabled={feedbackM.isPending || !feedback.trim()} onClick={() => feedbackM.mutate(feedback.trim())}>
                    Send feedback
                  </button>
                </section>
              ) : null}

              {activeTab === 'activity' ? (
                <section className="myTasksTabPanel">
                  <div className="myTasksTimeline">
                    {timeline.length ? timeline.slice().reverse().map(e => (
                      <article key={e.id}>
                        <span><Activity size={14} /></span>
                        <div>
                          <strong>{sanitizeEventLabel(e.event_type)}</strong>
                          <p>{e.note || e.to_status || 'Task activity recorded.'}</p>
                          <small>{e.actor_name || 'System'} · {formatDateTime(e.created_at)}</small>
                        </div>
                      </article>
                    )) : <div className="myTasksEmptyState">No activity has been recorded yet.</div>}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
