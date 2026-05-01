import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

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
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search.trim()
    ? options.filter(o => `${o.label} ${o.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    : options

  const closeMe = useCallback(() => { setOpen(false); setSearch('') }, [])

  useEffect(() => {
    _selectListeners.add(closeMe)
    return () => { _selectListeners.delete(closeMe) }
  }, [closeMe])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!open) return
    const rect = ref.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      const above = rect.top
      setOpenUp(!!preferOpenUp || (below < 260 && above > below))
    }
    if (searchable && inputRef.current) setTimeout(() => inputRef.current?.focus(), 20)
  }, [open, preferOpenUp, searchable])

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

      {open && (
        <div className={`selectV3Dropdown ${openUp ? 'selectV3DropdownUp' : ''}`.trim()} role="listbox">
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
        </div>
      )}
      {error && <div className="selectV3ErrorMsg">{error}</div>}
    </div>
  )
}
