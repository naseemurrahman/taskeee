import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isAuthed, clearAuth, isSessionPolicyExpired, isAccessTokenExpired, touchSessionActivity } from '../state/auth'

/** Detects auth loss/session expiry and redirects cleanly. */
export function SessionGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [expired, setExpired] = useState(false)
  const redirectTimer = useRef<number | null>(null)

  function clearRedirectTimer() {
    if (redirectTimer.current != null) {
      window.clearTimeout(redirectTimer.current)
      redirectTimer.current = null
    }
  }

  function expireSession() {
    if (!location.pathname.startsWith('/app')) return
    setExpired(true)
    clearAuth()
    clearRedirectTimer()
    redirectTimer.current = window.setTimeout(() => {
      navigate('/signin?reason=session_expired', { replace: true })
      redirectTimer.current = null
    }, 1200)
  }

  useEffect(() => {
    // Hide stale expiry banner immediately after successful login/navigation away.
    if (!location.pathname.startsWith('/app')) {
      setExpired(false)
      clearRedirectTimer()
      return
    }

    if (isAuthed() && !isSessionPolicyExpired() && !isAccessTokenExpired()) {
      setExpired(false)
      clearRedirectTimer()
      return
    }

    expireSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!location.pathname.startsWith('/app')) return

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
    const onActivity = () => {
      if (!isSessionPolicyExpired() && !isAccessTokenExpired()) touchSessionActivity()
    }
    for (const event of activityEvents) window.addEventListener(event, onActivity, { passive: true })

    const interval = window.setInterval(() => {
      if (isSessionPolicyExpired() || isAccessTokenExpired()) expireSession()
    }, 30_000)

    return () => {
      for (const event of activityEvents) window.removeEventListener(event, onActivity)
      window.clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigate])

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if ((e.key === 'tf_access_token' || e.key === 'tf_user') && !e.newValue) {
        if (location.pathname.startsWith('/app')) expireSession()
      }
      if ((e.key === 'tf_access_token' || e.key === 'tf_user') && e.newValue) {
        setExpired(false)
        clearRedirectTimer()
      }
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', () => {
      if (isAuthed() && !isSessionPolicyExpired() && !isAccessTokenExpired()) {
        setExpired(false)
        clearRedirectTimer()
      }
    })
    return () => {
      window.removeEventListener('storage', handleStorage)
      clearRedirectTimer()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigate])

  if (!expired || !location.pathname.startsWith('/app')) return null

  return (
    <div className="sessionExpiredBanner" role="alert">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Session expired — redirecting to sign in…
      </div>
      <button
        onClick={() => navigate('/signin', { replace: true })}
        style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 8, color: '#fff', padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
      >
        Sign in now
      </button>
    </div>
  )
}
