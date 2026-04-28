import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

export function Modal(props: {
  title: string
  subtitle?: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  icon?: ReactNode
  bodyClassName?: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!props.open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [props.open, props.onClose])

  if (!props.open) return null

  function handleOverlayClick(e: React.MouseEvent) {
    // Only close if clicking the overlay itself, not content inside the card
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
      props.onClose()
    }
  }

  return (
    <div
      className="modalOverlayV2"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={handleOverlayClick}
    >
      <div
        ref={cardRef}
        className={`modalCardV2 ${props.wide ? 'modalCardV2Wide' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modalV2Head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {props.icon && <div className="modalV2Icon">{props.icon}</div>}
            <div>
              <div className="modalV2Title">{props.title}</div>
              {props.subtitle && <div className="modalV2Sub">{props.subtitle}</div>}
            </div>
          </div>
          <button className="modalV2Close" onClick={props.onClose} aria-label="Close" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={`modalV2Body ${props.bodyClassName || ''}`.trim()}>
          {props.children}
        </div>

        {/* Footer */}
        {props.footer && <div className="modalV2Foot">{props.footer}</div>}
      </div>
    </div>
  )
}
