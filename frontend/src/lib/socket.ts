import { io, Socket } from 'socket.io-client'
import { getAccessToken } from '../state/auth'

let socket: Socket | null = null

const SOCKET_URL = (() => {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL.trim().replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://localhost:3001'
  return window.location.origin
})()

export function getSocket(): Socket {
  if (socket && socket.connected) return socket

  socket = io(SOCKET_URL, {
    auth: { token: getAccessToken() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    timeout: 10000,
  })

  socket.on('connect', () => {
    const user = (() => { try { const u = localStorage.getItem('tf_user'); return u ? JSON.parse(u) : null } catch { return null } })()
    const s = socket
    if (s && user?.orgId) s.emit('join:org', { orgId: user.orgId })
    if (s && user?.id) s.emit('join:user', { userId: user.id })
  })
  socket.on('disconnect', () => { /* silent reconnect */ })
  socket.on('connect_error', (err) => { if (err.message !== 'xhr poll error') console.warn('[Socket]', err.message) })

  return socket
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null }
}

/** All real-time event types broadcast by the server */
export type OrgEvent =
  | 'task:updated'        // task status changed, assigned, etc.
  | 'task:created'        // new task created
  | 'task:commented'      // comment posted
  | 'employee:added'      // new employee joined org
  | 'employee:updated'    // employee profile changed
  | 'notification'        // in-app notification
  | 'board:moved'         // card dragged to new column

export function subscribeToOrg(callbacks: {
  onTaskUpdated?:    (data: any) => void
  onTaskCreated?:    (data: any) => void
  onNotification?:  (data: any) => void
  onTaskCommented?:  (data: any) => void
  onEmployeeAdded?:  (data: any) => void
  onEmployeeUpdated?: (data: any) => void
  onBoardMoved?:    (data: any) => void
}) {
  const s = getSocket()
  if (callbacks.onTaskUpdated)    s.on('task:updated',    callbacks.onTaskUpdated)
  if (callbacks.onTaskCreated)    s.on('task:created',    callbacks.onTaskCreated)
  if (callbacks.onNotification)   s.on('notification',    callbacks.onNotification)
  if (callbacks.onTaskCommented)  s.on('task:commented',  callbacks.onTaskCommented)
  if (callbacks.onEmployeeAdded)  s.on('employee:added',  callbacks.onEmployeeAdded)
  if (callbacks.onEmployeeUpdated) s.on('employee:updated', callbacks.onEmployeeUpdated)
  if (callbacks.onBoardMoved)     s.on('board:moved',     callbacks.onBoardMoved)
  return () => {
    if (callbacks.onTaskUpdated)    s.off('task:updated',    callbacks.onTaskUpdated)
    if (callbacks.onTaskCreated)    s.off('task:created',    callbacks.onTaskCreated)
    if (callbacks.onNotification)   s.off('notification',    callbacks.onNotification)
    if (callbacks.onTaskCommented)  s.off('task:commented',  callbacks.onTaskCommented)
    if (callbacks.onEmployeeAdded)  s.off('employee:added',  callbacks.onEmployeeAdded)
    if (callbacks.onEmployeeUpdated) s.off('employee:updated', callbacks.onEmployeeUpdated)
    if (callbacks.onBoardMoved)     s.off('board:moved',     callbacks.onBoardMoved)
  }
}

/**
 * useRealtimeInvalidation — drop into any page to auto-invalidate React Query
 * cache keys whenever the matching socket event fires.
 * Usage: useRealtimeInvalidation({ tasks: true, employees: true })
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useRealtimeInvalidation(opts: {
  tasks?:     boolean
  employees?: boolean
  board?:     boolean
  dashboard?: boolean
}) {
  const qc = useQueryClient()
  useEffect(() => {
    return subscribeToOrg({
      onTaskUpdated: opts.tasks ? () => {
        qc.invalidateQueries({ queryKey: ['tasks'] })
        if (opts.dashboard) qc.invalidateQueries({ queryKey: ['dashboard'] })
      } : undefined,
      onTaskCreated: opts.tasks ? () => {
        qc.invalidateQueries({ queryKey: ['tasks'] })
        if (opts.dashboard) qc.invalidateQueries({ queryKey: ['dashboard'] })
      } : undefined,
      onBoardMoved: opts.board ? () => {
        qc.invalidateQueries({ queryKey: ['tasks', 'board'] })
        if (opts.dashboard) qc.invalidateQueries({ queryKey: ['dashboard'] })
      } : undefined,
      onEmployeeAdded: opts.employees ? () => {
        qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
        qc.invalidateQueries({ queryKey: ['dashboard'] })
      } : undefined,
      onEmployeeUpdated: opts.employees ? () => {
        qc.invalidateQueries({ queryKey: ['hris', 'employees'] })
      } : undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
