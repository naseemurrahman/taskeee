import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Global registry: only one Select open at a time
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
}

export function Select({
  value, onChange, options, placeholder = 'Selectâ¦', label,
  disabled, error, required, searchable, className,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

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
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || dropRef.current?.contains(t)) return
      setOpen(false); setSearch('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (!open) return
    function onScroll() { if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect()) }
    function onResize() { onScroll() }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useEffect(() => {
    if (open && searchable) setTimeout(() => inputRef.current?.focus(), 20)
  }, [open, searchable])

  function openSelect() {
    if (disabled) return
    if (open) { setOpen(false); setSearch(''); return }
    closeAllSelects()
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen(true)
  }

  function handleSelect(opt: SelectOption) {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false); setSearch('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setSearch('') }
    if ((e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); openSelect() }
  }

  // Compute dropdown position
  const dropStyle: React.CSSProperties = rect ? (() => {
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const dropH = Math.min(300, filtered.length * 44 + (searchable ? 48 : 0) + 16)
    const goUp = spaceBelow < dropH + 8 && spaceAbove > spaceBelow
    return {
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 180),
      zIndex: 999999,
      ...(goUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    }
  })() : { position: 'fixed', zIndex: 999999 }

  const dropdown = open && rect ? createPortal(
    <div
      ref={dropRef}
      className="selectV3Dropdown"
      style={dropStyle}
      role="listbox"
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
            placeholder="Searchâ¦"
            onMouseDown={e => e.stopPropagation()}
          />
        </div>
      )}
      <div className="selectV3List">
        {filtered.length === 0 ? (
          <div className="selectV3Empty">No options found</div>
        ) : filtered.map(opt => (
          <div
            key={opt.value}
            className={`selectV3Option ${opt.value === value ? 'selectV3OptionActive' : ''} ${opt.disabled ? 'selectV3OptionDisabled' : ''}`}
            onMouseDown={e => { e.preventDefault(); handleSelect(opt) }}
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
    </div>,
    document.body
  ) : null

  return (
    <div className={`selectV3Wrap ${className || ''}`} ref={wrapRef}>
      {label && (
        <label className="selectV3Label">
          {label}{required && <span className="selectV3Required"> *</span>}
        </label>
      )}
      <div
        ref={triggerRef}
        className={`selectV3Trigger ${open ? 'selectV3Open' : ''} ${error ? 'selectV3Error' : ''} ${disabled ? 'selectV3Disabled' : ''}`}
        onClick={openSelect}
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
      {dropdown}
      {error && <div className="selectV3ErrorMsg">{error}</div>}
    </div>
  )
}
