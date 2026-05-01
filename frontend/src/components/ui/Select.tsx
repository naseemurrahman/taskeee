import { useState, useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

const _selectListeners = new Set<() => void>()
function closeAllSelects() { _selectListeners.forEach(fn => fn()) }

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

export function Select({
  value, onChange, options, placeholder = 'Select…', label,
  disabled, error, required, searchable, className, preferOpenUp,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [openUp, setOpenUp] = useState(false)
  const [listMaxHeight, setListMaxHeight] = useState(240)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search.trim()
    ? options.filter(o => `${o.label} ${o.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    : options

  const closeMe = useCallback(() => { setOpen(false); setSearch('') }, [])
  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const mobile = window.innerWidth <= 640
    const viewportPadding = mobile ? 8 : 12
    const viewportHeight = window.innerHeight
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - viewportPadding)
    const spaceAbove = Math.max(0, rect.top - viewportPadding)
    const shouldOpenUp = !!preferOpenUp || (!mobile && spaceBelow < 260 && spaceAbove > spaceBelow)
    const available = shouldOpenUp ? spaceAbove : spaceBelow
    const maxHeight = Math.max(160, Math.min(mobile ? 420 : 320, available - 8))
    const width = mobile ? Math.min(window.innerWidth - viewportPadding * 2, Math.max(rect.width, 280)) : rect.width
    const left = mobile ? viewportPadding : Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding))
    const top = shouldOpenUp ? rect.top - 8 : rect.bottom + 8

    setOpenUp(shouldOpenUp)
    setListMaxHeight(maxHeight)
    setDropdownStyle({
      position: 'fixed',
      left,
      top,
      width,
      zIndex: 100500,
      transform: shouldOpenUp ? 'translateY(-100%)' : 'none',
    })
  }, [preferOpenUp])

  useEffect(() => {
    _selectListeners.add(closeMe)
    return () => { _selectListeners.delete(closeMe) }
  }, [closeMe])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(updateMenuPosition)
    const handler = () => updateMenuPosition()
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [open, filtered.length, updateMenuPosition])

  useEffect(() => {
    if (open && searchable && inputRef.current) inputRef.current.focus()
  }, [open, searchable])

  function handleSelect(opt: SelectOption) {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    setSearch('')
  }

  function toggleOpen() {
    if (disabled) return
    if (!open) closeAllSelects()
    setOpen(v => !v)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setSearch('') }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) { closeAllSelects(); setOpen(true) }
    }
  }

  return (
    <div className={`selectV3Wrap ${open ? 'selectV3WrapOpen' : ''} ${className || ''}`.trim()} ref={ref}>
      {label && (
        <label className="selectV3Label">
          {label}{required && <span className="selectV3Required"> *</span>}
        </label>
      )}
      <div
        ref={triggerRef}
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

      {open && createPortal((
        <div ref={dropdownRef} className={`selectV3Dropdown ${openUp ? 'selectV3DropdownUp' : ''}`.trim()} role="listbox" style={dropdownStyle}>
          {searchable && (
            <div className="selectV3SearchWrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input ref={inputRef} className="selectV3SearchInput" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" onClick={e => e.stopPropagation()} />
            </div>
          )}
          <div className="selectV3List" style={{ maxHeight: listMaxHeight }}>
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
        </div>
      ), document.body)}
      {error && <div className="selectV3ErrorMsg">{error}</div>}
    </div>
  )
}
