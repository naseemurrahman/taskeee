const PRESETS = [
  '#000000',
  '#808080',
  '#800000',
  '#ff0000',
  '#ffa500',
  '#ffff00',
  '#008000',
  '#00ffff',
  '#000080',
  '#800080',
  '#ffffff',
  '#c0c0c0',
  '#8b4513',
  '#ffc0cb',
  '#ffd700',
  '#ffffe0',
  '#90ee90',
  '#87ceeb',
  '#6a5acd',
  '#dda0dd',
]

function normalizeHex(v: string, fallback: string) {
  const s = v.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  return fallback
}

export function ColorSwatchPicker(props: { value: string; onChange: (hex: string) => void; labelId?: string }) {
  const current = normalizeHex(props.value, '#f4ca57')

  return (
    <div className="colorSwatchPicker" aria-labelledby={props.labelId}>
      <div className="colorSwatchGrid" role="listbox" aria-label="Preset colors">
        {PRESETS.map((hex) => {
          const selected = hex.toLowerCase() === current
          return (
            <button
              key={hex}
              type="button"
              role="option"
              aria-selected={selected}
              className={`colorSwatch ${selected ? 'colorSwatchSelected' : ''}`}
              style={{ backgroundColor: hex }}
              title={hex}
              onClick={() => props.onChange(hex)}
            />
          )
        })}
      </div>
      <div className="colorSwatchCustomRow">
        <span className="colorSwatchCustomLabel">Custom</span>
        <label className="colorSwatchNative">
          <input type="color" value={current} onChange={(e) => props.onChange(e.target.value)} aria-label="Custom color" />
          <span className="colorSwatchNativePreview" style={{ backgroundColor: current }} />
        </label>
      </div>
    </div>
  )
}
