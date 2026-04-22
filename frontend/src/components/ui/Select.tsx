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
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const closeMe = useCallback(() => { setOpen(false); setSearch('') }, [])
  useEffect(() => {
    _selectListeners.add(closeMe)
    return () => { _selectListeners.delete(closeMe) }
  }, [closeMe])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open && searchable && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open, searchable])

  useEffect(() => {
    if (!open || !ref.current) return
    const updatePosition = () => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const estimatedDropdownHeight = searchable ? 300 : 250
      const modalBody = ref.current.closest('.modalV2Body')
      const bounds = modalBody
        ? modalBody.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight }
      const spaceBelow = Math.max(0, bounds.bottom - rect.bottom)
      const spaceAbove = Math.max(0, rect.top - bounds.top)
      const shouldOpenUp = preferOpenUp || (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow)
      setOpenUp(shouldOpenUp)
      const available = shouldOpenUp ? spaceAbove : spaceBelow
      setListMaxHeight(Math.max(120, Math.min(280, Math.floor(available - 14))))
      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        zIndex: 4000,
        ...(shouldOpenUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, searchable, filtered.length, preferOpenUp])

  function handleSelect(opt: SelectOption) {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false); setSearch('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setSearch('') }
    if (e.key === 'Enter' || e.key === ' ') { if (!open) setOpen(true) }
  }

  const dropdownNode = open ? (
    <div
      ref={dropdownRef}
      className={`selectV3Dropdown ${openUp ? 'selectV3DropdownUp' : ''}`.trim()}
      role="listbox"
      style={dropdownStyle}
    >
      {searchable && (
        <div className="selectV3SearchWrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="selectV3SearchInput"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      <div className="selectV3List" style={{ maxHeight: listMaxHeight }}>
        {filtered.length === 0 ? (
          <div className="selectV3Empty">No options found</div>
        ) : filtered.map(opt => (
          <div
            key={opt.value}
            className={`selectV3Option ${opt.value === value ? 'selectV3OptionActive' : ''} ${opt.disabled ? 'selectV3OptionDisabled' : ''}`}
            onClick={() => handleSelect(opt)}
            role="option"
            aria-selected={opt.value === value}
          >
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
        className={`selectV3Trigger ${open ? 'selectV3Open' : ''} ${error ? 'selectV3Error' : ''} ${disabled ? 'selectV3Disabled' : ''}`}
        onClick={() => {
          if (disabled) return
          if (!open) { closeAllSelects() }
          setOpen(v => !v)
        }}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
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
        <svg
          className={`selectV3Chevron ${open ? 'selectV3ChevronOpen' : ''}`}
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && typeof document !== 'undefined' ? createPortal(dropdownNode, document.body) : null}
      {error && <div className="selectV3ErrorMsg">{error}</div>}
    </div>
  )
}
