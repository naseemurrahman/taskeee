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

  socket.on('connect', () => console.log('[Socket] connected'))
  socket.on('disconnect', () => console.log('[Socket] disconnected'))
  socket.on('connect_error', (err) => console.warn('[Socket] error:', err.message))

  return socket
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null }
}

export function subscribeToOrg(callbacks: {
  onTaskUpdated?: (data: any) => void
  onNotification?: (data: any) => void
  onTaskCommented?: (data: any) => void
}) {
  const s = getSocket()
  if (callbacks.onTaskUpdated) s.on('task:updated', callbacks.onTaskUpdated)
  if (callbacks.onNotification) s.on('notification', callbacks.onNotification)
  if (callbacks.onTaskCommented) s.on('task:commented', callbacks.onTaskCommented)
  return () => {
    if (callbacks.onTaskUpdated) s.off('task:updated', callbacks.onTaskUpdated)
    if (callbacks.onNotification) s.off('notification', callbacks.onNotification)
    if (callbacks.onTaskCommented) s.off('task:commented', callbacks.onTaskCommented)
  }
}
