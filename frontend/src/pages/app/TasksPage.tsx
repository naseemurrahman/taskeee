import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { Link, useSearchParams } from 'react-router-dom'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { getUser } from '../../state/auth'
import { TaskInsightsPanel } from '../../components/tasks/TaskInsightsPanel'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { useI18n } from '../../i18n'

type Task = {
  id: string
  title: string
  status: string
  priority?: string
  due_date?: string | null
  assigned_to?: string | null
  assigned_to_name?: string
  category_name?: string | null
}

type InsightsResponse = {
  insights?: any
  generatedAt?: string
  timeRange?: string
  taskCount?: number
  fallback?: boolean
  message?: string
}

async function fetchInsights(timeRange: string) {
  const qs = new URLSearchParams({ timeRange })
  return await apiFetch<InsightsResponse>(`/api/v1/insights?${qs.toString()}`)
}

async function fetchTasks(status: string) {
  const qs = new URLSearchParams({ limit: '80', page: '1' })
  if (status && status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?${qs.toString()}`)
  return (data.tasks || data.rows || []) as Task[]
}

const QUICK: { key: string; labelKey: string }[] = [
  { key: 'all', labelKey: 'common.all' },
  { key: 'pending', labelKey: 'common.pending' },
  { key: 'in_progress', labelKey: 'common.active' },
  { key: 'submitted', labelKey: 'common.submitted' },
  { key: 'completed', labelKey: 'common.done' },
  { key: 'overdue', labelKey: 'common.overdue' },
]

export function TasksPage() {
  const { t } = useI18n()
  const me = getUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFromUrl = searchParams.get('status') || 'all'
  const [status, setStatus] = useState<string>(statusFromUrl)
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    setStatus(statusFromUrl)
  }, [statusFromUrl])

  function setStatusFilter(next: string) {
    setStatus(next)
    if (next === 'all') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ status: next }, { replace: true })
    }
  }

  const q = useQuery({ queryKey: ['tasks', 'list', status], queryFn: () => fetchTasks(status) })
  const insightsQ = useQuery({ queryKey: ['tasks', 'insights', '30d'], queryFn: () => fetchInsights('30d'), retry: false })
  const tasks = useMemo(() => q.data || [], [q.data])

  const aiM = useMutation({
    mutationFn: async (taskId: string) => apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/ai-review`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
        qc.invalidateQueries({ queryKey: ['performance', 'summary'] }),
        qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] }),
        qc.invalidateQueries({ queryKey: ['jeczone', 'tasks'] }),
        qc.invalidateQueries({ queryKey: ['analytics', 'summary'] }),
      ])
    },
  })

  function formatDue(iso: string | null | undefined) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>{t('title.tasks')}</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>{t('common.filterDescription')}</div>
          </div>
          <div className="tasksHeaderActions">
            {canCreateTasksAndProjects(me?.role) ? (
              <button type="button" className="btn btnPrimary" onClick={() => setOpen(true)}>
                {t('common.createTask')}
              </button>
            ) : null}
            <label className="label">
              {t('common.taskStatus')}
              <select className="input" value={status} onChange={(e) => setStatusFilter(e.target.value)}>
                {QUICK.map((x) => (
                  <option key={x.key} value={x.key}>{t(x.labelKey)}</option>
                ))}
              </select>
            </label>
            <Link className="btn btnGhost" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', textDecoration: 'none' }} to="/app/board">
              {t('common.openBoard')}
            </Link>
            <Link className="btn btnGhost" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', textDecoration: 'none' }} to="/app/analytics">
              {t('dashboard.analytics')}
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 900, marginBottom: 8, letterSpacing: '0.06em' }}>{t('common.quickFilters')}</div>
          <div className="taskQuickFilters" role="group" aria-label={t('common.quickFilters')}>
            {QUICK.map((x) => (
              <button
                key={x.key}
                type="button"
                className={`taskQuickFilterBtn ${status === x.key ? 'taskQuickFilterBtnActive' : ''}`}
                onClick={() => setStatusFilter(x.key)}
              >
                {t(x.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>{t('common.loading')}</div> : null}
        {q.isError ? <div className="alert alertError">{t('common.failedLoadTasks')}</div> : null}
        {!q.isLoading && tasks.length === 0 ? (
          <div style={{ marginTop: 12, color: 'var(--text2)' }}>
            {canCreateTasksAndProjects(me?.role) ? t('common.noTasksYetCreate') : t('common.noTasksYetAsk')}
          </div>
        ) : null}

        <div style={{ marginTop: 12 }} />
        <div className="miniCard" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{t('common.aiSummary')}</div>
            <Link to="/app/insights" style={{ color: 'var(--primary)', fontWeight: 900, fontSize: 12, textDecoration: 'none' }}>
              {t('common.openInsights')}
            </Link>
          </div>
          <TaskInsightsPanel
            loading={insightsQ.isLoading}
            error={!!insightsQ.isError}
            message={insightsQ.data?.message ?? null}
            payload={insightsQ.data ?? null}
          />
        </div>

        <div style={{ marginTop: 12 }} />
        <div className="taskListBody">
          {tasks.map((task) => (
            <div key={task.id} className="taskRow">
              <div className="taskRowMain">
                <div className="taskTitle">{task.title}</div>
                {task.category_name || task.due_date || task.assigned_to_name ? (
                  <div className="taskSubline">
                    {task.category_name ? <span>{task.category_name}</span> : null}
                    {task.assigned_to_name ? <span>{task.assigned_to_name}</span> : null}
                    {task.due_date ? <span>Due {formatDue(task.due_date)}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="taskRowActions">
                {me?.id && task.status === 'submitted' && (task.assigned_to ? task.assigned_to === me.id : true) ? (
                  <button
                    type="button"
                    className="btn btnPrimary"
                    style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    disabled={aiM.isPending}
                    onClick={() => aiM.mutate(task.id)}
                  >
                    {aiM.isPending ? t('common.sending') : t('common.aiReview')}
                  </button>
                ) : null}
              </div>
              <div className="taskMeta">
                <span className="pill">{task.status}</span>
                {task.priority ? <span className="pill pillMuted">{task.priority}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <CreateTaskModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
