const ACCESS_TOKEN_KEY = 'tf_access_token'
const REFRESH_TOKEN_KEY = 'tf_refresh_token'
const USER_KEY = 'tf_user'

export function getAccessToken(): string | null {
  // Also check legacy key names from old versions
  return localStorage.getItem(ACCESS_TOKEN_KEY) ||
         localStorage.getItem('auth_token') ||
         null
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || null
}

export function setAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token)
  // Clean up any legacy keys
  localStorage.removeItem('auth_token')
  localStorage.removeItem('tf_auth')
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
}

export function clearAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  // Also clean legacy keys
  localStorage.removeItem('auth_token')
  localStorage.removeItem('tf_auth')
}

export function isAuthed(): boolean {
  return !!getAccessToken()
}
