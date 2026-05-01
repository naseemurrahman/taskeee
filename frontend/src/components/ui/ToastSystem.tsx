import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

interface ToastCtx {
  toasts: Toast[]
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  dismiss: (id: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const COLORS: Record<ToastType, { border: string; icon: string; bg: string }> = {
  success: { border: 'rgba(34,197,94,0.35)', icon: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  error:   { border: 'rgba(239,68,68,0.35)',  icon: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  warning: { border: 'rgba(245,158,11,0.35)', icon: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  info:    { border: 'rgba(56,189,248,0.35)', icon: '#38bdf8', bg: 'rgba(56,189,248,0.08)' },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // mount -> animate in
    requestAnimationFrame(() => setVisible(true))
    const dur = toast.duration ?? 4000
    if (dur > 0) {
      timerRef.current = setTimeout(() => dismiss(), dur)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss() {
    setLeaving(true)
    setTimeout(onDismiss, 320)
  }

  const c = COLORS[toast.type]

  return (
    <div
      onClick={dismiss}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 14,
        border: `1px solid ${c.border}`,
        background: `rgba(15,17,22,0.96)`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${c.border}, inset 0 1px 0 rgba(255,255,255,0.06)`,
        backdropFilter: 'blur(20px)',
        cursor: 'pointer',
        maxWidth: 360,
        width: '100%',
        transition: 'transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.32s ease',
        transform: visible && !leaving ? 'translateX(0)' : 'translateX(100%)',
        opacity: visible && !leaving ? 1 : 0,
        userSelect: 'none',
      }}
    >
      {/* Icon circle */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: c.bg, border: `1px solid ${c.border}`,
        display: 'grid', placeItems: 'center', flexShrink: 0,
        color: c.icon, fontSize: 13, fontWeight: 900,
      }}>
        {ICONS[toast.type]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.3 }}>{toast.title}</div>
        {toast.message && (
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>{toast.message}</div>
        )}
      </div>
      {/* Close x */}
      <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>✕</div>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts(prev => [...prev.slice(-4), { ...opts, id }]) // keep max 5
  }, [])

  const success = useCallback((title: string, message?: string) => toast({ type: 'success', title, message }), [toast])
  const error   = useCallback((title: string, message?: string) => toast({ type: 'error',   title, message }), [toast])
  const warning = useCallback((title: string, message?: string) => toast({ type: 'warning', title, message }), [toast])
  const info    = useCallback((title: string, message?: string) => toast({ type: 'info',    title, message }), [toast])
  const dismiss = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  return (
    <Ctx.Provider value={{ toasts, toast, success, error, warning, info, dismiss }}>
      {children}
      {/* Portal-like fixed container */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
        display: 'flex', flexDirection: 'column-reverse', gap: 10,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
