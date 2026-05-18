type TopbarButtonConfig = {
  selector: string
  getLabel: (button: HTMLElement) => string
}

const configs: TopbarButtonConfig[] = [
  { selector: '.topbarV4MenuBtn', getLabel: () => '☰' },
  { selector: '.topbarNotifyBtn', getLabel: () => '!' },
  {
    selector: '.topbarThemeBtn',
    getLabel: (button) => {
      const text = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.toLowerCase()
      if (text.includes('light')) return '☾'
      if (text.includes('auto')) return 'A'
      return '☀'
    },
  },
  {
    selector: '.topbarLangBtn',
    getLabel: (button) => {
      const text = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.toUpperCase()
      if (text.includes('AR')) return 'AR'
      if (text.includes('EN')) return 'EN'
      return '🌐'
    },
  },
  {
    selector: '.topbarV4ProfileBtn',
    getLabel: (button) => {
      if (button.querySelector('img')) return ''
      const title = button.getAttribute('title')?.trim()
      return title ? title.charAt(0).toUpperCase() : 'U'
    },
  },
]

function installStyle() {
  if (document.getElementById('topbar-action-visibility-guard')) return
  const style = document.createElement('style')
  style.id = 'topbar-action-visibility-guard'
  style.textContent = `
    .appShellV4 .topbarV4 :is(.topbarV4MenuBtn,.topbarNotifyBtn,.topbarThemeBtn,.topbarLangBtn,.topbarV4ProfileBtn) {
      position: relative !important;
      display: inline-grid !important;
      place-items: center !important;
      color: #f7d890 !important;
      -webkit-text-fill-color: #f7d890 !important;
      background: linear-gradient(180deg, rgba(24,31,44,.98), rgba(13,18,29,.98)) !important;
      border: 1px solid rgba(226,171,65,.42) !important;
    }
    .appShellV4Light .topbarV4 :is(.topbarV4MenuBtn,.topbarNotifyBtn,.topbarThemeBtn,.topbarLangBtn,.topbarV4ProfileBtn) {
      color: #7c2d12 !important;
      -webkit-text-fill-color: #7c2d12 !important;
      background: linear-gradient(180deg, #ffffff, #eef2f7) !important;
      border-color: rgba(180,83,9,.32) !important;
    }
    .appShellV4 .topbarV4 .topbarActionGlyphFallback {
      position: absolute !important;
      inset: 0 !important;
      z-index: 20 !important;
      display: grid !important;
      place-items: center !important;
      width: 100% !important;
      height: 100% !important;
      color: currentColor !important;
      -webkit-text-fill-color: currentColor !important;
      font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif !important;
      font-size: 18px !important;
      font-weight: 950 !important;
      line-height: 1 !important;
      text-align: center !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: none !important;
      text-shadow: none !important;
    }
    .appShellV4 .topbarV4 .topbarLangBtn .topbarActionGlyphFallback {
      font-size: 11px !important;
      letter-spacing: .02em !important;
    }
    .appShellV4 .topbarV4 .topbarV4ProfileBtn .topbarActionGlyphFallback {
      font-size: 14px !important;
    }
    .appShellV4 .topbarV4 .topbarV4ProfileBtn:has(img) .topbarActionGlyphFallback {
      display: none !important;
    }
    .appShellV4 .topbarV4 :is(.topbarV4MenuBtn,.topbarNotifyBtn,.topbarThemeBtn,.topbarLangBtn,.topbarV4ProfileBtn) > svg {
      position: relative !important;
      z-index: 10 !important;
      color: currentColor !important;
      stroke: currentColor !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    .appShellV4 .topbarV4 .topbarLangBtn > span:not(.topbarActionGlyphFallback) {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}

function ensureGlyph(button: HTMLElement, label: string) {
  let glyph = button.querySelector<HTMLSpanElement>(':scope > .topbarActionGlyphFallback')
  if (!label) {
    glyph?.remove()
    return
  }
  if (!glyph) {
    glyph = document.createElement('span')
    glyph.className = 'topbarActionGlyphFallback'
    glyph.setAttribute('aria-hidden', 'true')
    button.appendChild(glyph)
  }
  if (glyph.textContent !== label) glyph.textContent = label
}

function refreshTopbarButtons() {
  installStyle()
  for (const config of configs) {
    document.querySelectorAll<HTMLElement>(config.selector).forEach((button) => {
      ensureGlyph(button, config.getLabel(button))
    })
  }
}

if (typeof window !== 'undefined') {
  const run = () => refreshTopbarButtons()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
  else run()

  const observer = new MutationObserver(() => refreshTopbarButtons())
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'title', 'aria-label'],
  })

  window.addEventListener('resize', run)
}
