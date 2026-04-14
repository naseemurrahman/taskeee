import type { ReactNode } from 'react'

export function Modal(props: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  if (!props.open) return null
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={() => props.onClose()}>
      <div className={`modalCard ${props.wide ? 'modalCardWide' : ''}`.trim()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">{props.title}</div>
          </div>
          <button className="btn btnGhost" style={{ height: 36, padding: '0 10px' }} onClick={props.onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="modalBody">{props.children}</div>
        {props.footer ? <div className="modalFoot">{props.footer}</div> : null}
      </div>
    </div>
  )
}

