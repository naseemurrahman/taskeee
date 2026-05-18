const TOUCH_DELTA_THRESHOLD = 4

function installPullRefreshStyles() {
  if (document.getElementById('mobile-pull-to-refresh-guard-style')) return
  const style = document.createElement('style')
  style.id = 'mobile-pull-to-refresh-guard-style'
  style.textContent = `
    html,
    body,
    #root {
      overscroll-behavior: none !important;
      overscroll-behavior-y: none !important;
      overscroll-behavior-x: none !important;
    }

    .appShellV4,
    .mainV4 {
      overscroll-behavior: none !important;
      overscroll-behavior-y: none !important;
      overscroll-behavior-x: none !important;
    }

    .contentV4,
    .sidebarV4Nav,
    .modalCardV2,
    .topbarNotifyList,
    .topbarV4SearchDropdown,
    .selectV3Dropdown,
    .profileDropdown {
      overscroll-behavior: contain !important;
      overscroll-behavior-y: contain !important;
      -webkit-overflow-scrolling: touch;
    }
  `
  document.head.appendChild(style)
}

function isScrollableY(el: Element) {
  const node = el as HTMLElement
  if (!node || node === document.body || node === document.documentElement) return false
  const style = window.getComputedStyle(node)
  const overflowY = style.overflowY
  const canScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
  return canScrollStyle && node.scrollHeight > node.clientHeight + 1
}

function nearestScrollableY(start: Element | null) {
  let el: Element | null = start
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollableY(el)) return el as HTMLElement
    el = el.parentElement
  }
  return null
}

function rootScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

function installPullToRefreshGuard() {
  if (typeof window === 'undefined') return
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return
  if ((window as any).__taskeePullToRefreshGuardInstalled) return
  ;(window as any).__taskeePullToRefreshGuardInstalled = true

  installPullRefreshStyles()

  let startX = 0
  let startY = 0

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
  }

  const onTouchMove = (event: TouchEvent) => {
    if (event.defaultPrevented || event.touches.length !== 1) return

    const touch = event.touches[0]
    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    if (Math.abs(deltaY) < TOUCH_DELTA_THRESHOLD) return
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) return

    const target = event.target instanceof Element ? event.target : null
    const scrollable = nearestScrollableY(target)

    if (scrollable) {
      const atTop = scrollable.scrollTop <= 0
      const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault()
      }
      return
    }

    if (rootScrollTop() <= 0 && deltaY > 0) {
      event.preventDefault()
    }
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
}

installPullToRefreshGuard()
