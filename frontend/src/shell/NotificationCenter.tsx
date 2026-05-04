import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { useToast } from '../components/ui/ToastSystem'
import { subscribeToOrg } from '../lib/socket'

type InAppNotification = {
  id: string
  type: string
  title: string
  body?: string | null
  data?: unknown
  is_read?: boolean
  created_at: string
}

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

export function NotificationCenter() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { success: _toastSuccess } = useToast()
  const [open, setOpen] = useState(false)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
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

  function goFromNotif(n: InAppNotification) {
    setOpen(false)
    const tid = taskIdFromData(n.data)
    if (tid) navigate('/app/tasks', { state: { openTaskId: tid } })
    else navigate('/app/dashboard')
  }

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
              <div className="topbarNotifySub">{unread > 0 ? `${unread} unread` : 'All caught up'}</div>
            </div>
            {unread > 0 ? (
              <button type="button" className="topbarNotifyMarkAll" onClick={() => markAllM.mutate()} disabled={markAllM.isPending}>
                Mark all read
              </button>
            ) : null}
          </div>
          {q.isLoading ? <div className="topbarNotifyEmpty">Loading notifications...</div> : null}
          {q.isError ? <div className="topbarNotifyEmpty">Could not load notifications.</div> : null}
          {!q.isLoading && !list.length ? <div className="topbarNotifyEmpty">You are all caught up.</div> : null}
          <div className="topbarNotifyList">
            {list.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`topbarNotifyItem ${n.is_read ? '' : 'topbarNotifyItemUnread'}`}
                onClick={() => {
                  if (!n.is_read) markReadM.mutate(n.id)
                  goFromNotif(n)
                }}
              >
                <div className="topbarNotifyItemRow">
                  <span className="topbarNotifyDot" />
                  <div className="topbarNotifyItemText">
                    <div className="topbarNotifyItemTitle">{n.title || 'Notification'}</div>
                    {n.body ? <div className="topbarNotifyItemBody">{n.body}</div> : null}
                    <div className="topbarNotifyItemMeta">{formatWhen(n.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
