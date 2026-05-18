function requestChartResize() {
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'))
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 260)
  })
}

function installChartRenderGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if ((window as any).__taskeeChartRenderGuardInstalled) return
  ;(window as any).__taskeeChartRenderGuardInstalled = true

  const schedule = (() => {
    let timer: number | null = null
    return () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        requestChartResize()
      }, 60)
    }
  })()

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        const addedChart = Array.from(record.addedNodes).some((node) => {
          if (!(node instanceof Element)) return false
          return node.matches?.('.recharts-responsive-container, .recharts-wrapper') ||
            !!node.querySelector?.('.recharts-responsive-container, .recharts-wrapper')
        })
        if (addedChart) {
          schedule()
          return
        }
      }
      if (record.type === 'attributes' && record.target instanceof Element) {
        const el = record.target
        if (el.closest?.('.contentV4') && (record.attributeName === 'class' || record.attributeName === 'style')) {
          schedule()
          return
        }
      }
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  })

  window.addEventListener('load', requestChartResize, { passive: true })
  window.addEventListener('orientationchange', requestChartResize, { passive: true })
  window.visualViewport?.addEventListener('resize', requestChartResize, { passive: true })
  window.setTimeout(requestChartResize, 0)
  window.setTimeout(requestChartResize, 400)
  window.setTimeout(requestChartResize, 1000)
}

installChartRenderGuard()
