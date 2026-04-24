import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { apiFetch } from '../lib/api'

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
      const o = JSON.parse(data) as { taskId?: string }
      return o.taskId
    } catch {
      return undefined
    }
  }
  if (typeof data === 'object' && 'taskId' in (data as object)) {
    const v = (data as { taskId?: string }).taskId
    return v ? String(v) : undefined
  }
  return undefined
}

import { subscribeToOrg } from '../lib/socket'

export function NotificationCenter() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ notifications: InAppNotification[]; unreadCount: number }>('/api/v1/notifications'),
    staleTime: 15_000,
    refetchInterval: open ? 20_000 : 45_000,
  })

  // Real-time: socket push invalidates notification + task queries immediately
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
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const unread = q.data?.unreadCount ?? 0
  const list = q.data?.notifications ?? []

  function goFromNotif(n: InAppNotification) {
    setOpen(false)
    const tid = taskIdFromData(n.data)
    if (tid) navigate('/app/tasks')
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
        {unread > 0 ? <span className="topbarNotifyBadge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="topbarNotifyPopover" role="dialog" aria-label="Notifications">
          <div className="topbarNotifyHead">
            <span style={{ fontWeight: 900 }}>Notifications</span>
            {unread > 0 ? (
              <button type="button" className="topbarNotifyMarkAll" onClick={() => markAllM.mutate()} disabled={markAllM.isPending}>
                Mark all read
              </button>
            ) : null}
          </div>
          {q.isLoading ? <div className="topbarNotifyEmpty">Loading…</div> : null}
          {q.isError ? <div className="topbarNotifyEmpty">Could not load notifications.</div> : null}
          {!q.isLoading && !list.length ? <div className="topbarNotifyEmpty">You’re all caught up.</div> : null}
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
                <div className="topbarNotifyItemTitle">{n.title}</div>
                {n.body ? <div className="topbarNotifyItemBody">{n.body}</div> : null}
                <div className="topbarNotifyItemMeta">{new Date(n.created_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
