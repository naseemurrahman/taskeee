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
  category_color?: string | null
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

const FILTERS: { key: string; labelKey: string; color?: string }[] = [
  { key: 'all', labelKey: 'common.all' },
  { key: 'pending', labelKey: 'common.pending', color: 'rgba(244,202,87,0.8)' },
  { key: 'in_progress', labelKey: 'common.active', color: 'rgba(56,189,248,0.8)' },
  { key: 'submitted', labelKey: 'common.submitted', color: 'rgba(109,94,252,0.8)' },
  { key: 'completed', labelKey: 'common.done', color: 'rgba(16,185,129,0.8)' },
  { key: 'overdue', labelKey: 'common.overdue', color: 'rgba(239,68,68,0.8)' },
]

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f4ca57',
  low: '#6d5efc',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'rgba(244,202,87,0.18)',
  in_progress: 'rgba(56,189,248,0.18)',
  submitted: 'rgba(109,94,252,0.18)',
  completed: 'rgba(16,185,129,0.18)',
  overdue: 'rgba(239,68,68,0.18)',
  manager_approved: 'rgba(16,185,129,0.18)',
}
const STATUS_TEXT_COLOR: Record<string, string> = {
  pending: '#f4ca57',
  in_progress: '#38bdf8',
  submitted: '#8b7cf7',
  completed: '#10b981',
  overdue: '#ef4444',
  manager_approved: '#10b981',
}

function formatDue(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.round(diff / 86400000)
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return { label, overdue: days < 0, dueToday: days === 0, soon: days > 0 && days <= 3 }
}

function Avatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['#f4ca57', '#6d5efc', '#10b981', '#38bdf8', '#f97316', '#a78bfa']
  const color = colors[initials.charCodeAt(0) % colors.length]
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 3, flexShrink: 0,
      background: `${color}20`, border: `1px solid ${color}40`,
      display: 'grid', placeItems: 'center',
      fontSize: size * 0.35, fontWeight: 900, color,
    }}>
      {initials}
    </div>
  )
}

export function TasksPage() {
  const { t } = useI18n()
  const me = getUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFromUrl = searchParams.get('status') || 'all'
  const [status, setStatus] = useState<string>(statusFromUrl)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'compact'>('list')
  const qc = useQueryClient()

  useEffect(() => { setStatus(statusFromUrl) }, [statusFromUrl])

  function setStatusFilter(next: string) {
    setStatus(next)
    setSearchParams(next === 'all' ? {} : { status: next }, { replace: true })
  }

  const q = useQuery({ queryKey: ['tasks', 'list', status], queryFn: () => fetchTasks(status) })
  const insightsQ = useQuery({ queryKey: ['tasks', 'insights', '30d'], queryFn: () => fetchInsights('30d'), retry: false })
  const tasks = useMemo(() => {
    const all = q.data || []
    if (!search.trim()) return all
    const s = search.toLowerCase()
    return all.filter(t =>
      t.title?.toLowerCase().includes(s) ||
      t.assigned_to_name?.toLowerCase().includes(s) ||
      t.category_name?.toLowerCase().includes(s)
    )
  }, [q.data, search])

  const counts = useMemo(() => {
    const all = q.data || []
    return FILTERS.reduce((acc, f) => {
      acc[f.key] = f.key === 'all' ? all.length : all.filter(t => t.status === f.key).length
      return acc
    }, {} as Record<string, number>)
  }, [q.data])

  const aiM = useMutation({
    mutationFn: async (taskId: string) =>
      apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/ai-review`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
        qc.invalidateQueries({ queryKey: ['performance', 'summary'] }),
        qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] }),
      ])
    },
  })

  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, letterSpacing: '-0.6px', fontSize: 22 }}>{t('title.tasks')}</h2>
          <div style={{ color: 'var(--text2)', marginTop: 3, fontSize: 13 }}>{t('common.filterDescription')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {(['list', 'compact'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                style={{
                  height: 36, padding: '0 12px', border: 'none', cursor: 'pointer',
                  background: view === v ? 'rgba(244,202,87,0.12)' : 'transparent',
                  color: view === v ? '#f4ca57' : 'var(--text2)',
                  fontWeight: 800, fontSize: 12,
                  borderRight: v === 'list' ? '1px solid var(--border)' : 'none',
                }}
              >
                {v === 'list' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/>
                    <circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
          <Link className="btn btnGhost btnSm" to="/app/board">Board</Link>
          <Link className="btn btnGhost btnSm" to="/app/analytics">{t('dashboard.analytics')}</Link>
          {canCreateTasksAndProjects(me?.role) ? (
            <button type="button" className="btn btnPrimary btnSm" onClick={() => setOpen(true)}>
              + {t('common.createTask')}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Filter tabs + search ── */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                style={{
                  padding: '6px 14px', borderRadius: 99, border: '1px solid',
                  cursor: 'pointer', fontSize: 13, fontWeight: 800,
                  transition: 'all 0.15s ease',
                  borderColor: status === f.key ? (f.color || 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.08)',
                  background: status === f.key ? (f.color ? f.color + '22' : 'rgba(255,255,255,0.08)') : 'transparent',
                  color: status === f.key ? (f.color || 'var(--text)') : 'var(--text2)',
                }}
              >
                {t(f.labelKey)}
                {counts[f.key] > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.75 }}>{counts[f.key]}</span>
                )}
              </button>
            ))}
          </div>
          <input
            className="input"
            style={{ height: 36, width: 220, fontSize: 13 }}
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── AI Summary ── */}
      <div className="miniCard" style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <div style={{ fontWeight: 950, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            {t('common.aiSummary')}
          </div>
          <Link to="/app/insights" style={{ color: 'var(--primary)', fontWeight: 900, fontSize: 12, textDecoration: 'none' }}>
            {t('common.openInsights')} →
          </Link>
        </div>
        <TaskInsightsPanel
          loading={insightsQ.isLoading}
          error={!!insightsQ.isError}
          message={insightsQ.data?.message ?? null}
          payload={insightsQ.data ?? null}
        />
      </div>

      {/* ── Task list ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 120px 100px 80px',
          gap: 12, padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.025)',
        }}>
          {['Task', 'Assigned to', 'Project', 'Due', 'Status'].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
          ))}
        </div>

        {q.isLoading && (
          <div style={{ padding: 20, color: 'var(--text2)' }}>{t('common.loading')}</div>
        )}
        {q.isError && (
          <div className="alert alertError" style={{ margin: 16 }}>{t('common.failedLoadTasks')}</div>
        )}
        {!q.isLoading && tasks.length === 0 && (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text2)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>No tasks found</div>
            <div style={{ fontSize: 13 }}>
              {canCreateTasksAndProjects(me?.role) ? t('common.noTasksYetCreate') : t('common.noTasksYetAsk')}
            </div>
            {canCreateTasksAndProjects(me?.role) && (
              <button type="button" className="btn btnPrimary" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
                + {t('common.createTask')}
              </button>
            )}
          </div>
        )}

        {tasks.map((task, idx) => {
          const due = formatDue(task.due_date)
          const statusBg = STATUS_COLOR[task.status] || 'rgba(255,255,255,0.07)'
          const statusTxt = STATUS_TEXT_COLOR[task.status] || 'var(--text2)'
          const prioColor = task.priority ? PRIORITY_COLOR[task.priority.toLowerCase()] : null

          return (
            <div
              key={task.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 120px 100px 80px',
                gap: 12,
                padding: '13px 18px',
                borderBottom: idx < tasks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                transition: 'background 0.15s',
                alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Title + priority */}
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                {prioColor && (
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: prioColor, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
                    {task.title}
                  </div>
                  {task.priority && (
                    <div style={{ fontSize: 11, color: prioColor || 'var(--muted)', fontWeight: 700, marginTop: 2 }}>
                      {task.priority}
                    </div>
                  )}
                </div>
              </div>

              {/* Assignee */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                {task.assigned_to_name ? (
                  <>
                    <Avatar name={task.assigned_to_name} size={24} />
                    <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.assigned_to_name}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                )}
              </div>

              {/* Project */}
              <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.category_name ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 8px', borderRadius: 6,
                    background: task.category_color ? `${task.category_color}18` : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${task.category_color ? task.category_color + '30' : 'rgba(255,255,255,0.08)'}`,
                    color: task.category_color || 'var(--text2)',
                    fontSize: 11, fontWeight: 800,
                  }}>
                    {task.category_name}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
              </div>

              {/* Due date */}
              <div style={{ fontSize: 12 }}>
                {due ? (
                  <span style={{
                    color: due.overdue ? '#ef4444' : due.dueToday ? '#f4ca57' : due.soon ? '#f97316' : 'var(--text2)',
                    fontWeight: due.overdue || due.dueToday ? 800 : 600,
                  }}>
                    {due.overdue ? '⚠ ' : due.dueToday ? '• ' : ''}{due.label}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
              </div>

              {/* Status + AI action */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <span style={{
                  padding: '3px 8px', borderRadius: 6,
                  background: statusBg, color: statusTxt,
                  fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                }}>
                  {task.status.replace(/_/g, ' ')}
                </span>
                {me?.id && task.status === 'submitted' && (task.assigned_to ? task.assigned_to === me.id : true) && (
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'rgba(109,94,252,0.18)', color: '#8b7cf7',
                      fontSize: 10, fontWeight: 800,
                    }}
                    disabled={aiM.isPending}
                    onClick={() => aiM.mutate(task.id)}
                  >
                    {aiM.isPending ? '…' : '⚡ AI'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <CreateTaskModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
