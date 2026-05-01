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

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

export function Select({
  value, onChange, options, placeholder = 'Select…', label,
  disabled, error, required, searchable, className, preferOpenUp,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [openUp, setOpenUp] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const [listMaxHeight, setListMaxHeight] = useState(260)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search.trim()
    ? options.filter(o => `${o.label} ${o.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    : options

  const closeMe = useCallback(() => { setOpen(false); setSearch('') }, [])

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = vw <= 640 ? 8 : 12
    const mobile = vw <= 640
    const minWidth = Math.min(220, vw - pad * 2)
    const maxWidth = Math.min(searchable ? 360 : 320, vw - pad * 2)
    const width = mobile ? vw - pad * 2 : clamp(rect.width, minWidth, maxWidth)
    const left = mobile ? pad : clamp(rect.left, pad, vw - width - pad)
    const spaceBelow = vh - rect.bottom - pad
    const spaceAbove = rect.top - pad
    const shouldUp = !!preferOpenUp || (!mobile && spaceBelow < 240 && spaceAbove > spaceBelow)
    const available = shouldUp ? spaceAbove : spaceBelow
    const maxHeight = clamp(available - 8, 160, mobile ? 420 : 320)
    setOpenUp(shouldUp)
    setListMaxHeight(maxHeight)
    setMenuStyle({ position: 'fixed', zIndex: 100600, left, top: shouldUp ? rect.top - 8 : rect.bottom + 8, width, maxWidth: width, transform: shouldUp ? 'translateY(-100%)' : 'none' })
  }, [preferOpenUp, searchable])

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
    requestAnimationFrame(updatePosition)
    const handler = () => updatePosition()
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [open, filtered.length, updatePosition])

  useEffect(() => {
    if (open && searchable && inputRef.current) setTimeout(() => inputRef.current?.focus(), 20)
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

  const menu = open ? (
    <div ref={dropdownRef} className={`selectV3Dropdown ${openUp ? 'selectV3DropdownUp' : ''}`.trim()} role="listbox" style={menuStyle}>
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
  ) : null

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
      {menu ? createPortal(menu, document.body) : null}
      {error && <div className="selectV3ErrorMsg">{error}</div>}
    </div>
  )
}
