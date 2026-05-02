import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isAuthed, clearAuth } from '../state/auth'

/** Detects auth loss and redirects cleanly with a brief banner */
export function SessionGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    // Check on every route change
    if (!isAuthed() && location.pathname.startsWith('/app')) {
      setExpired(true)
      clearAuth()
      const t = setTimeout(() => {
        navigate('/signin?reason=session_expired', { replace: true })
      }, 2000)
      return () => clearTimeout(t)
    }
  }, [location.pathname, navigate])

  // Listen for storage events (logout in another tab)
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if ((e.key === 'tf_access_token' || e.key === 'tf_user') && !e.newValue) {
        if (location.pathname.startsWith('/app')) {
          setExpired(true)
          clearAuth()
          setTimeout(() => navigate('/signin?reason=session_expired', { replace: true }), 1800)
        }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [location.pathname, navigate])

  if (!expired) return null

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
