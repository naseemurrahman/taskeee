import { type InputHTMLAttributes, type ReactNode, useRef, useState } from 'react'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> {
  label?: string
  error?: string
  hint?: string
  prefix?: ReactNode
  suffix?: ReactNode
  icon?: ReactNode
}

export function Input({ label, error, hint, prefix, suffix, icon, className, ...props }: InputProps) {
  const [showPwd, setShowPwd] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isPassword = props.type === 'password'
  const isDate = props.type === 'date'
  const inputType = isPassword ? (showPwd ? 'text' : 'password') : props.type
  return (
    <div className="inputV3Wrap">
      {label && (
        <label className="selectV3Label" htmlFor={props.id}>
          {label}{props.required && <span className="selectV3Required"> *</span>}
        </label>
      )}
      <div className={`inputV3Field ${error ? 'inputV3FieldError' : ''} ${props.disabled ? 'inputV3FieldDisabled' : ''}`}>
        {icon && <span className="inputV3Icon">{icon}</span>}
        {prefix && <span className="inputV3Prefix">{prefix}</span>}
        <input
          {...props}
          ref={inputRef}
          type={inputType}
          className={`inputV3Native ${className || ''}`}
          style={{ paddingLeft: icon ? 36 : prefix ? undefined : 14 }}
        />
        {isDate && (
          <button
            type="button"
            className="inputV3Suffix"
            onClick={() => {
              const el = inputRef.current
              if (!el) return
              ;(el as any).showPicker?.()
              el.focus()
            }}
            aria-label="Open date picker"
            tabIndex={-1}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </button>
        )}
        {isPassword && (
          <button
            type="button"
            className="inputV3Suffix"
            onClick={() => setShowPwd(v => !v)}
            tabIndex={-1}
          >
            {showPwd
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        )}
        {suffix && !isPassword && <span className="inputV3Suffix">{suffix}</span>}
      </div>
      {error && <div className="inputV3Error">{error}</div>}
      {hint && !error && <div className="inputV3Hint">{hint}</div>}
    </div>
  )
}
