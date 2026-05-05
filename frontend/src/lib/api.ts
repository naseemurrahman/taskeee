import { getAccessToken, getRefreshToken, setAccessToken, clearAuth, isAccessTokenExpired, isSessionPolicyExpired, touchSessionActivity } from '../state/auth'

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
const REQUEST_TIMEOUT_MS = 20_000

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

function buildUrl(path: string): string {
  return `${API_BASE.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`
}

async function parseResponse(res: Response) {
  const contentType = res.headers.get('content-type') || ''
  return contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null)
}

function redirectToSignIn() {
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin') && !window.location.pathname.startsWith('/signup')) {
    window.location.replace('/signin?reason=session_expired')
  }
}

let refreshPromise: Promise<string | null> | null = null

async function tryRefreshToken(): Promise<string | null> {
  // Professional session policy: do not silently refresh an expired access token after page refresh
  // or after idle/absolute session expiry. User must sign in again.
  if (isSessionPolicyExpired() || isAccessTokenExpired()) {
    clearAuth()
    redirectToSignIn()
    return null
  }

  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  if (refreshPromise) return refreshPromise

  refreshPromise = fetch(buildUrl('/api/v1/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) { clearAuth(); return null }
      const data = await res.json().catch(() => null)
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

async function doFetch<T>(path: string, init?: RequestInit & { json?: Json; timeoutMs?: number }, retried = false): Promise<T> {
  if (isSessionPolicyExpired()) {
    clearAuth()
    redirectToSignIn()
    throw new ApiError('Session expired. Please sign in again.', 401, null)
  }

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

  const timeoutMs = typeof init?.timeoutMs === 'number' && init.timeoutMs > 0 ? init.timeoutMs : REQUEST_TIMEOUT_MS
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = init?.signal
    ? ((AbortSignal as any).any ? (AbortSignal as any).any([init.signal, timeoutController.signal]) : timeoutController.signal)
    : timeoutController.signal

  let res: Response
  try {
    const { timeoutMs: _omitTimeout, ...restInit } = (init || {}) as RequestInit & { timeoutMs?: number }
    res = await fetch(buildUrl(path), {
      ...restInit,
      headers,
      body,
      signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 408, null)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  const data = await parseResponse(res)

  if (!res.ok) {
    if ((res.status === 401 || (res.status === 400 && isErrorShape(data) && data.error.toLowerCase().includes('token'))) && !retried) {
      const newToken = await tryRefreshToken()
      if (newToken) return doFetch<T>(path, init, true)
      clearAuth()
      redirectToSignIn()
    }

    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }

  touchSessionActivity()
  return data as T
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit & { json?: Json; timeoutMs?: number }): Promise<T> {
  return doFetch<T>(path, init)
}

export async function apiUpload<T = unknown>(path: string, formData: FormData, init?: Omit<RequestInit, 'body'>): Promise<T> {
  if (isSessionPolicyExpired()) {
    clearAuth()
    redirectToSignIn()
    throw new ApiError('Session expired. Please sign in again.', 401, null)
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const signal = init?.signal
    ? ((AbortSignal as any).any ? (AbortSignal as any).any([init.signal, timeoutController.signal]) : timeoutController.signal)
    : timeoutController.signal

  let res: Response
  try {
    res = await fetch(buildUrl(path), { ...init, method: init?.method || 'POST', headers, body: formData, signal })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('Upload timed out. Please try again.', 408, null)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
  const data = await parseResponse(res)

  if (!res.ok) {
    if (res.status === 401) clearAuth()
    const message = isErrorShape(data) ? data.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }
  touchSessionActivity()
  return data as T
}
