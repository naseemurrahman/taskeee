import { getAccessToken, clearAuth } from '../state/auth'

const getApiBase = (): string => {
  // If explicitly set via environment variable (Vite build --mode)
  if (import.meta.env.VITE_API_BASE_URL) {
    const url = import.meta.env.VITE_API_BASE_URL.trim().replace(/\/$/, '')
    // Auto-prepend https:// if missing (handles Railway URLs without scheme)
    if (url && !url.startsWith('http')) return `https://${url}`
    return url
  }
  // In development, use localhost
  if (import.meta.env.DEV) return 'http://localhost:3001'
  // In production (including Docker/Fly.io), use relative path (proxied via nginx)
  return ''
}
const API_BASE = getApiBase()

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

function isErrorShape(value: unknown): value is { error: string } {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return typeof rec.error === 'string'
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit & { json?: Json }) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  }

  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let body: BodyInit | undefined = init?.body ?? undefined
  if (init && 'json' in init) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body })

  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null)

  if (!res.ok) {
    if (res.status === 401) clearAuth()
    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }

  return data as T
}

/** Multipart upload (e.g. task photos). Do not set Content-Type; the browser sets the boundary. */
export async function apiUpload<T = unknown>(path: string, formData: FormData, init?: Omit<RequestInit, 'body'>) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  }

  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, method: init?.method || 'POST', headers, body: formData })

  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null)

  if (!res.ok) {
    if (res.status === 401) clearAuth()
    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }

  return data as T
}

