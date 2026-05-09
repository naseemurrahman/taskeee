import { useState, useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

const _selectListeners = new Set<() => void>()

export interface SelectOption {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  color?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  label?: string
  disabled?: boolean
  error?: string
  required?: boolean
  searchable?: boolean
  className?: string
  preferOpenUp?: boolean
}

type OverlayLayer = 'page' | 'notification' | 'modal'
type OpenDirection = 'up' | 'down'

function overlayLayerFor(el: HTMLElement | null): OverlayLayer {
  if (!el) return 'page'
  if (el.closest('.modalOverlayV2, .modalV2, [role="dialog"][aria-modal="true"]')) return 'modal'
  if (el.closest('.topbarNotifyPopover')) return 'notification'
  return 'page'
}

function zIndexForLayer(layer: OverlayLayer) {
  if (layer === 'modal') return 2147483200
  if (layer === 'notification') return 2147483100
  return 2147483000
}

export function Select({
  value, onChange, options, placeholder = 'Select…', label,
  disabled, error, required, searchable, className, preferOpenUp,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropStyle, setDropStyle] = useState<CSSProperties>({})
  const [overlayLayer, setOverlayLayer] = useState<OverlayLayer>('page')
  const [openDirection, setOpenDirection] = useState<OpenDirection>('down')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search.trim()
    ? options.filter(o => `${o.label} ${o.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    : options

  const closeMe = useCallback(() => { setOpen(false); setSearch('') }, [])

  const closeOtherSelects = useCallback(() => {
    _selectListeners.forEach(fn => {
      if (fn !== closeMe) fn()
    })
  }, [closeMe])

  const positionDropdown = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return

    const layer = overlayLayerFor(ref.current)
    setOverlayLayer(layer)

    const viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
    const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
    const below = viewportH - rect.bottom
    const above = rect.top
    const openUp = !!preferOpenUp || (below < 240 && above > below)
    const direction: OpenDirection = openUp ? 'up' : 'down'
    setOpenDirection(direction)

    const dropWidth = Math.min(Math.max(rect.width, 180), Math.max(180, viewportW - 16))
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportW - dropWidth - 8))
    const availableHeight = Math.max(120, openUp ? above - 12 : below - 12)
    const maxHeight = Math.max(160, Math.min(420, availableHeight))
    const top = rect.bottom + 4
    const bottom = viewportH - rect.top + 4

    const nextStyle = {
      position: 'fixed',
      left,
      right: 'auto',
      width: dropWidth,
      maxHeight,
      zIndex: zIndexForLayer(layer),
      '--select-left': `${Math.round(left)}px`,
      '--select-width': `${Math.round(dropWidth)}px`,
      '--select-max-height': `${Math.round(maxHeight)}px`,
      '--select-z-index': String(zIndexForLayer(layer)),
      '--select-top': openUp ? 'auto' : `${Math.round(top)}px`,
      '--select-bottom': openUp ? `${Math.round(bottom)}px` : 'auto',
    } as CSSProperties

    if (openUp) {
      setDropStyle({ ...nextStyle, top: 'auto', bottom })
    } else {
      setDropStyle({ ...nextStyle, top, bottom: 'auto' })
    }
  }, [preferOpenUp])

  useEffect(() => {
    _selectListeners.add(closeMe)
    return () => { _selectListeners.delete(closeMe) }
  }, [closeMe])

  useEffect(() => {
    function handleClick(e: MouseEvent | PointerEvent) {
      const target = e.target as HTMLElement
      if (ref.current?.contains(target)) return
      if (target.closest('.selectV3Dropdown[data-select-portal="true"]')) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [])

  useEffect(() => {
    function handleCloseAll() {
      setOpen(false)
      setSearch('')
    }
    window.addEventListener('taskee:close-selects', handleCloseAll)
    return () => window.removeEventListener('taskee:close-selects', handleCloseAll)
  }, [])

  useEffect(() => {
    if (!open) return
    positionDropdown()
    if (searchable && inputRef.current) setTimeout(() => inputRef.current?.focus(), 20)

    window.addEventListener('resize', positionDropdown)
    window.addEventListener('scroll', positionDropdown, true)
    return () => {
      window.removeEventListener('resize', positionDropdown)
      window.removeEventListener('scroll', positionDropdown, true)
    }
  }, [open, positionDropdown, searchable])

  function handleSelect(opt: SelectOption) {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    setSearch('')
  }

  function toggleOpen() {
    if (disabled) return
    if (open) {
      setOpen(false)
      setSearch('')
      return
    }
    closeOtherSelects()
    setOpen(true)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setSearch('') }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open) {
        setOpen(false)
        setSearch('')
      } else {
        closeOtherSelects()
        setOpen(true)
      }
    }
  }

  const dropdown = open ? createPortal(
    <div
      className="selectV3Dropdown"
      role="listbox"
      style={dropStyle}
      data-overlay-layer={overlayLayer}
      data-open-direction={openDirection}
      data-select-portal="true"
    >
      {searchable && (
        <div className="selectV3SearchWrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input ref={inputRef} className="selectV3SearchInput" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" onClick={e => e.stopPropagation()} />
        </div>
      )}
      <div className="selectV3List">
        {filtered.length === 0 ? (
          <div className="selectV3Empty">No options found</div>
        ) : filtered.map(opt => (
          <div key={opt.value} className={`selectV3Option ${opt.value === value ? 'selectV3OptionActive' : ''} ${opt.disabled ? 'selectV3OptionDisabled' : ''}`} onClick={() => handleSelect(opt)} role="option" aria-selected={opt.value === value}>
            {opt.icon && <span className="selectV3OptionIcon">{opt.icon}</span>}
            {opt.color && <span className="selectV3ColorDot" style={{ background: opt.color }} />}
            <div className="selectV3OptionText">
              <span className="selectV3OptionLabel">{opt.label}</span>
              {opt.description && <span className="selectV3OptionDesc">{opt.description}</span>}
            </div>
            {opt.value === value && (
              <svg className="selectV3Check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <div className={`selectV3Wrap ${open ? 'selectV3WrapOpen' : ''} ${className || ''}`.trim()} ref={ref}>
        {label && (
          <label className="selectV3Label">
            {label}{required && <span className="selectV3Required"> *</span>}
          </label>
        )}
        <div
          className={`selectV3Trigger ${open ? 'selectV3Open' : ''} ${error ? 'selectV3Error' : ''} ${disabled ? 'selectV3Disabled' : ''}`}
          onClick={toggleOpen}
          onKeyDown={handleKeyDown}
          tabIndex={disabled ? -1 : 0}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-disabled={disabled}
        >
          <div className="selectV3Value">
            {selected ? (
              <div className="selectV3Selected">
                {selected.icon && <span className="selectV3Icon">{selected.icon}</span>}
                {selected.color && <span className="selectV3ColorDot" style={{ background: selected.color }} />}
                <span>{selected.label}</span>
              </div>
            ) : (
              <span className="selectV3Placeholder">{placeholder}</span>
            )}
          </div>
          <svg className={`selectV3Chevron ${open ? 'selectV3ChevronOpen' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {error && <div className="selectV3ErrorMsg">{error}</div>}
      </div>
      {dropdown}
    </>
  )
}
