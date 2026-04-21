import { getAccessToken, getRefreshToken, setAccessToken, clearAuth } from '../state/auth'

const getApiBase = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    const url = import.meta.env.VITE_API_BASE_URL.trim().replace(/\/$/, '')
    if (url && !url.startsWith('http')) return `https://${url}`
    return url
  }
  if (import.meta.env.DEV) return 'http://localhost:3001'
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

export function sanitizeApiErrorMessage(message: string): string {
  return message
    .replace(/(https?:\/\/)[^@\s]+@/gi, '$1***@')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, '***')
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback
  const raw = (err.message || '').trim()
  if (!raw) return fallback
  return sanitizeApiErrorMessage(raw)
}

function isErrorShape(value: unknown): value is { error: string } {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>).error === 'string'
}

// Token refresh state — prevent concurrent refreshes
let refreshPromise: Promise<string | null> | null = null

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  if (refreshPromise) return refreshPromise

  refreshPromise = fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async res => {
      if (!res.ok) { clearAuth(); return null }
      const data = await res.json()
      if (data?.accessToken) {
        setAccessToken(data.accessToken)
        return data.accessToken as string
      }
      clearAuth()
      return null
    })
    .catch(() => { clearAuth(); return null })
    .finally(() => { refreshPromise = null })

  return refreshPromise
}

async function doFetch<T>(path: string, init?: RequestInit & { json?: Json }, retried = false): Promise<T> {
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
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null)

  if (!res.ok) {
    // On 401 / 400 "No token" — try to refresh once
    if ((res.status === 401 || (res.status === 400 && isErrorShape(data) && data.error.toLowerCase().includes('token'))) && !retried) {
      const newToken = await tryRefreshToken()
      if (newToken) {
        return doFetch<T>(path, init, true)
      }
      clearAuth()
      // Redirect to sign-in if not already there
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin') && !window.location.pathname.startsWith('/signup')) {
        window.location.replace('/signin')
      }
    }

    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }

  return data as T
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit & { json?: Json }): Promise<T> {
  return doFetch<T>(path, init)
}

export async function apiUpload<T = unknown>(path: string, formData: FormData, init?: Omit<RequestInit, 'body'>): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, method: init?.method || 'POST', headers, body: formData })
  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null)

  if (!res.ok) {
    if (res.status === 401) clearAuth()
    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }
  return data as T
}
