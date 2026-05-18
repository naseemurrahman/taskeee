const TOUCH_DELTA_THRESHOLD = 4
const ROOT_SCROLL_PRIME = 1

function appViewportHeight() {
  return `${window.visualViewport?.height || window.innerHeight}px`
}

function installPullRefreshStyles() {
  if (document.getElementById('mobile-pull-to-refresh-guard-style')) return
  const style = document.createElement('style')
  style.id = 'mobile-pull-to-refresh-guard-style'
  style.textContent = `
    html.taskeeNoPullRefresh,
    html.taskeeNoPullRefresh body,
    html.taskeeNoPullRefresh #root {
      width: 100% !important;
      max-width: 100% !important;
      height: 100% !important;
      min-height: 100% !important;
      overflow: hidden !important;
      overscroll-behavior: none !important;
      overscroll-behavior-y: none !important;
      overscroll-behavior-x: none !important;
    }

    html.taskeeNoPullRefresh body {
      position: fixed !important;
      inset: 0 !important;
      touch-action: pan-y !important;
    }

    html.taskeeNoPullRefresh .appShellV4 {
      height: var(--taskee-vh, 100dvh) !important;
      min-height: var(--taskee-vh, 100dvh) !important;
      max-height: var(--taskee-vh, 100dvh) !important;
      overflow: hidden !important;
      overscroll-behavior: none !important;
      overscroll-behavior-y: none !important;
      overscroll-behavior-x: none !important;
    }

    html.taskeeNoPullRefresh .mainV4 {
      height: var(--taskee-vh, 100dvh) !important;
      min-height: 0 !important;
      max-height: var(--taskee-vh, 100dvh) !important;
      overflow: hidden !important;
      overscroll-behavior: none !important;
      overscroll-behavior-y: none !important;
    }

    html.taskeeNoPullRefresh .contentV4 {
      height: calc(var(--taskee-vh, 100dvh) - var(--topbar-height, 56px)) !important;
      min-height: 0 !important;
      max-height: calc(var(--taskee-vh, 100dvh) - var(--topbar-height, 56px)) !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      overscroll-behavior: contain !important;
      overscroll-behavior-y: contain !important;
      -webkit-overflow-scrolling: touch !important;
    }

    html.taskeeNoPullRefresh .sidebarV4Nav,
    html.taskeeNoPullRefresh .modalCardV2,
    html.taskeeNoPullRefresh .topbarNotifyList,
    html.taskeeNoPullRefresh .topbarV4SearchDropdown,
    html.taskeeNoPullRefresh .selectV3Dropdown,
    html.taskeeNoPullRefresh .profileDropdown,
    html.taskeeNoPullRefresh .tasksTableWrap,
    html.taskeeNoPullRefresh .tableWrap,
    html.taskeeNoPullRefresh .responsiveTableWrap,
    html.taskeeNoPullRefresh .chartV3:has(table) {
      overscroll-behavior: contain !important;
      overscroll-behavior-y: contain !important;
      -webkit-overflow-scrolling: touch !important;
    }
  `
  document.head.appendChild(style)
}

function updateViewportHeight() {
  document.documentElement.style.setProperty('--taskee-vh', appViewportHeight())
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
  const content = document.querySelector<HTMLElement>('.contentV4')
  return content && isScrollableY(content) ? content : null
}

function rootScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

function primeScrollableBoundary(el: HTMLElement | null) {
  if (!el || el.scrollHeight <= el.clientHeight + 1) return
  if (el.scrollTop <= 0) {
    el.scrollTop = 1
  } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
    el.scrollTop = Math.max(0, el.scrollTop - 1)
  }
}

function primeRootBoundary() {
  // Some mobile browsers only trigger pull-to-refresh when the root scroll is
  // exactly zero. Keep the root one CSS pixel away from that boundary; the app
  // itself scrolls inside .contentV4, so this is visually imperceptible.
  if (rootScrollTop() <= 0) {
    window.scrollTo(0, ROOT_SCROLL_PRIME)
    document.documentElement.scrollTop = ROOT_SCROLL_PRIME
    document.body.scrollTop = ROOT_SCROLL_PRIME
  }
}

function installPullToRefreshGuard() {
  if (typeof window === 'undefined') return
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return
  if ((window as any).__taskeePullToRefreshGuardInstalled) return
  ;(window as any).__taskeePullToRefreshGuardInstalled = true

  document.documentElement.classList.add('taskeeNoPullRefresh')
  installPullRefreshStyles()
  updateViewportHeight()

  let startX = 0
  let startY = 0
  let activeScrollable: HTMLElement | null = null

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    activeScrollable = nearestScrollableY(event.target instanceof Element ? event.target : null)
    primeScrollableBoundary(activeScrollable)
    primeRootBoundary()
  }

  const onTouchMove = (event: TouchEvent) => {
    if (event.defaultPrevented || event.touches.length !== 1) return

    const touch = event.touches[0]
    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    if (Math.abs(deltaY) < TOUCH_DELTA_THRESHOLD) return
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) return

    const scrollable = activeScrollable || nearestScrollableY(event.target instanceof Element ? event.target : null)

    if (scrollable) {
      const atTop = scrollable.scrollTop <= 0
      const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault()
      }
      return
    }

    if (deltaY > 0) {
      event.preventDefault()
      primeRootBoundary()
    }
  }

  const onScroll = () => {
    primeRootBoundary()
  }

  const onResize = () => {
    updateViewportHeight()
    primeRootBoundary()
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  window.visualViewport?.addEventListener('resize', onResize, { passive: true })
  window.setTimeout(primeRootBoundary, 0)
  window.setTimeout(primeRootBoundary, 300)
}

installPullToRefreshGuard()
