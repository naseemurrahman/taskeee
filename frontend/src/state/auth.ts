const ACCESS_TOKEN_KEY = 'tf_access_token'
const REFRESH_TOKEN_KEY = 'tf_refresh_token'
const USER_KEY = 'tf_user'
const SESSION_STARTED_KEY = 'tf_session_started_at'
const LAST_ACTIVITY_KEY = 'tf_last_activity_at'

// Professional default: require a fresh sign-in after inactivity or hard session expiry.
// These are frontend guards; backend refresh-token expiry still applies separately.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000

type JwtPayload = { exp?: number; iat?: number; [key: string]: unknown }

function decodeJwtPayload(token: string | null): JwtPayload | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map(c => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    )
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ||
         localStorage.getItem('auth_token') ||
         null
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || null
}

export function isAccessTokenExpired(token = getAccessToken(), skewSeconds = 15): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return true
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000
}

export function getSessionAgeMs(): number {
  const started = Number(localStorage.getItem(SESSION_STARTED_KEY) || 0)
  return started > 0 ? Date.now() - started : 0
}

export function getIdleMs(): number {
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0)
  return last > 0 ? Date.now() - last : 0
}

export function touchSessionActivity() {
  if (getAccessToken()) localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
}

export function isSessionPolicyExpired(): boolean {
  const started = Number(localStorage.getItem(SESSION_STARTED_KEY) || 0)
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0)
  const now = Date.now()
  if (started > 0 && now - started > ABSOLUTE_TIMEOUT_MS) return true
  if (last > 0 && now - last > IDLE_TIMEOUT_MS) return true
  return false
}

export function setAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token)
  localStorage.removeItem('auth_token')
  localStorage.removeItem('tf_auth')
  if (!localStorage.getItem(SESSION_STARTED_KEY)) {
    localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()))
  }
  touchSessionActivity()
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export type AuthUser = {
  id: string; email: string; fullName: string; role: string; orgId: string
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as AuthUser }
  catch { return null }
}

export function setUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  if (!localStorage.getItem(SESSION_STARTED_KEY)) {
    localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()))
  }
  touchSessionActivity()
}

export function clearAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(SESSION_STARTED_KEY)
  localStorage.removeItem(LAST_ACTIVITY_KEY)
  localStorage.removeItem('auth_token')
  localStorage.removeItem('tf_auth')
}

export function isAuthed(): boolean {
  const token = getAccessToken()
  if (!token) return false
  // On a fresh page refresh, do not silently treat an expired access token as authenticated.
  // This prevents a browser refresh from renewing an expired session without sign-in.
  if (isAccessTokenExpired(token) || isSessionPolicyExpired()) {
    clearAuth()
    return false
  }
  return true
}
