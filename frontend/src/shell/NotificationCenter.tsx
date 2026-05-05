import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, Settings, Activity, CheckCheck } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { useToast } from '../components/ui/ToastSystem'
import { subscribeToOrg } from '../lib/socket'
import { getUser } from '../state/auth'

type InAppNotification = {
  id: string
  type: string
  title: string
  body?: string | null
  data?: unknown
  is_read?: boolean
  created_at: string
  updated_at?: string | null
  dedupe_key?: string | null
  group_count?: number | null
  last_grouped_at?: string | null
  email_sent?: boolean | null
  whatsapp_sent?: boolean | null
  delivery_error?: string | null
}

type NotificationTab = 'all' | 'unread' | 'reminders' | 'tasks' | 'system'

function taskIdFromData(data: unknown): string | undefined {
  if (data == null) return undefined
  if (typeof data === 'string') {
    try {
      const o = JSON.parse(data) as { taskId?: string; task_id?: string }
      return o.taskId || o.task_id
    } catch {
      return undefined
    }
  }
  if (typeof data === 'object') {
    const v = data as { taskId?: string; task_id?: string }
    return v.taskId || v.task_id
  }
  return undefined
}

function formatWhen(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function notificationBucket(n: InAppNotification): Exclude<NotificationTab, 'all' | 'unread'> {
  const type = String(n.type || '').toLowerCase()
  if (type.includes('overdue') || type.includes('reminder') || type.includes('due')) return 'reminders'
  if (type.startsWith('task_') || taskIdFromData(n.data)) return 'tasks'
  return 'system'
}

function typeLabel(n: InAppNotification) {
  const bucket = notificationBucket(n)
  if (bucket === 'reminders') return 'Reminder'
  if (bucket === 'tasks') return 'Task'
  return 'System'
}

function effectiveDate(n: InAppNotification) {
  return n.last_grouped_at || n.updated_at || n.created_at
}

export function NotificationCenter() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = getUser()
  const isAdmin = ['admin', 'director'].includes(me?.role || '')
  const { success: toastSuccess } = useToast()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<NotificationTab>('all')
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ notifications: InAppNotification[]; unreadCount: number }>('/api/v1/notifications'),
    staleTime: 15_000,
    refetchInterval: open ? 20_000 : 45_000,
  })

  useEffect(() => {
    const unsub = subscribeToOrg({
      onNotification: () => {
        qc.invalidateQueries({ queryKey: ['notifications'] })
      },
      onTaskUpdated: () => {
        qc.invalidateQueries({ queryKey: ['tasks'] })
        qc.invalidateQueries({ queryKey: ['dashboard'] })
      },
      onTaskCommented: (data) => {
        if (data?.taskId) {
          qc.invalidateQueries({ queryKey: ['task-messages', data.taskId] })
        }
      },
    })
    return unsub
  }, [qc])

  const markReadM = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllM = useMutation({
    mutationFn: () => apiFetch('/api/v1/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toastSuccess('Notifications cleared', 'All notifications are marked as read.')
    },
  })

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDoc)
      document.addEventListener('keydown', onKey)
    }
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = q.data?.unreadCount ?? 0
  const list = q.data?.notifications ?? []
  const counts = useMemo(() => {
    const c: Record<NotificationTab, number> = { all: list.length, unread, reminders: 0, tasks: 0, system: 0 }
    for (const n of list) c[notificationBucket(n)] += 1
    return c
  }, [list, unread])
  const visibleList = useMemo(() => {
    return list.filter((n) => {
      if (tab === 'all') return true
      if (tab === 'unread') return !n.is_read
      return notificationBucket(n) === tab
    })
  }, [list, tab])

  function goFromNotif(n: InAppNotification) {
    setOpen(false)
    const tid = taskIdFromData(n.data)
    if (tid) navigate('/app/tasks', { state: { openTaskId: tid } })
    else navigate('/app/dashboard')
  }

  function openSettings() {
    setOpen(false)
    navigate('/app/settings', { state: { tab: 'notifications' } })
  }

  function openDiagnostics() {
    setOpen(false)
    navigate('/app/diagnostics')
  }

  const tabs: Array<{ key: NotificationTab; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'reminders', label: 'Reminders' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'system', label: 'System' },
  ]

  return (
    <div className="topbarNotifyWrap" ref={wrapRef}>
      <button
        type="button"
        className="topbarNotifyBtn"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {unread > 0 ? <span className="topbarNotifyBadge" style={{ animation: 'bellPulse 0.6s ease 3' }}>{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="topbarNotifyPopover" role="dialog" aria-label="Notifications">
          <div className="topbarNotifyHead">
            <div>
              <div className="topbarNotifyTitle">Notifications</div>
              <div className="topbarNotifySub">{unread > 0 ? `${unread} unread · grouped by task when repeated` : 'All caught up'}</div>
            </div>
            <div className="topbarNotifyHeadActions">
              {unread > 0 ? (
                <button type="button" className="topbarNotifyIconAction" onClick={() => markAllM.mutate()} disabled={markAllM.isPending} title="Mark all read">
                  <CheckCheck size={15} />
                </button>
              ) : null}
              <button type="button" className="topbarNotifyIconAction" onClick={openSettings} title="Notification settings">
                <Settings size={15} />
              </button>
              {isAdmin ? (
                <button type="button" className="topbarNotifyIconAction" onClick={openDiagnostics} title="Delivery diagnostics">
                  <Activity size={15} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="topbarNotifyTabs" role="tablist" aria-label="Notification filters">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`topbarNotifyTab ${tab === t.key ? 'topbarNotifyTabActive' : ''}`} onClick={() => setTab(t.key)}>
                <span>{t.label}</span>
                <span className="topbarNotifyTabCount">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="topbarNotifyQuickActions">
            <button type="button" onClick={openSettings}>Notification settings</button>
            {isAdmin ? <button type="button" onClick={openDiagnostics}>Delivery diagnostics</button> : null}
          </div>

          {q.isLoading ? <div className="topbarNotifyEmpty">Loading notifications...</div> : null}
          {q.isError ? <div className="topbarNotifyEmpty">Could not load notifications.</div> : null}
          {!q.isLoading && !visibleList.length ? <div className="topbarNotifyEmpty">No notifications in this view.</div> : null}
          <div className="topbarNotifyList">
            {visibleList.map((n) => {
              const grouped = Number(n.group_count || 0) > 1
              const bucket = notificationBucket(n)
              const typeColor = bucket === 'reminders' ? '#f59e0b' : bucket === 'tasks' ? 'var(--brand)' : 'var(--text2)'
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`topbarNotifyItem ${n.is_read ? '' : 'topbarNotifyItemUnread'}`}
                  onClick={() => {
                    if (!n.is_read) markReadM.mutate(n.id)
                    goFromNotif(n)
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '8px 1fr', gap: '0 10px', alignItems: 'start', width: '100%' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.is_read ? 'transparent' : typeColor, marginTop: 5, flexShrink: 0, border: n.is_read ? '1.5px solid var(--border)' : 'none' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: typeColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {typeLabel(n)}{grouped ? ` ×${n.group_count}` : ''}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{formatWhen(effectiveDate(n))}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.35, marginBottom: n.body ? 3 : 0 }}>
                        {n.title || 'Notification'}
                      </div>
                      {n.body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>{n.body}</div>}
                      {n.delivery_error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>⚠ Delivery failed</div>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
