const TOUCH_DELTA_THRESHOLD = 6
const REFRESH_THRESHOLD = 86
const MAX_PULL_DISTANCE = 128

function installPullRefreshStyles() {
  const existing = document.getElementById('mobile-pull-to-refresh-guard-style')
  if (existing) existing.remove()

  const style = document.createElement('style')
  style.id = 'mobile-pull-to-refresh-guard-style'
  style.textContent = `
    html,
    body,
    #root {
      overscroll-behavior-x: none;
    }

    .contentV4,
    .sidebarV4Nav,
    .modalCardV2,
    .topbarNotifyList,
    .topbarV4SearchDropdown,
    .selectV3Dropdown,
    .profileDropdown {
      -webkit-overflow-scrolling: touch;
    }

    .taskeePullRefreshIndicator {
      position: fixed;
      left: 50%;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-width: 132px;
      height: 34px;
      padding: 0 13px;
      border-radius: 999px;
      border: 1px solid rgba(226, 171, 65, 0.38);
      background: rgba(12, 15, 23, 0.94);
      color: #f8d98d;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
      font: 800 12px/1 Inter, system-ui, -apple-system, Segoe UI, sans-serif;
      opacity: 0;
      pointer-events: none;
      transform: translate3d(-50%, -70px, 0) scale(0.96);
      transition: opacity 140ms ease, transform 140ms ease;
      will-change: transform, opacity;
    }

    html[data-theme='light'] .taskeePullRefreshIndicator,
    .appShellV4Light ~ .taskeePullRefreshIndicator {
      background: rgba(255, 255, 255, 0.96);
      color: #7c2d12;
      border-color: rgba(180, 83, 9, 0.26);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
    }

    .taskeePullRefreshIndicator[data-state='pull'],
    .taskeePullRefreshIndicator[data-state='ready'],
    .taskeePullRefreshIndicator[data-state='refreshing'] {
      opacity: 1;
    }

    .taskeePullRefreshSpinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid currentColor;
      border-right-color: transparent;
      opacity: 0.9;
      transform: rotate(0deg);
    }

    .taskeePullRefreshIndicator[data-state='refreshing'] .taskeePullRefreshSpinner {
      animation: taskeePullRefreshSpin 0.7s linear infinite;
    }

    @keyframes taskeePullRefreshSpin {
      to { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)
}

function ensureIndicator() {
  let indicator = document.querySelector<HTMLDivElement>('.taskeePullRefreshIndicator')
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = 'taskeePullRefreshIndicator'
    indicator.setAttribute('role', 'status')
    indicator.setAttribute('aria-live', 'polite')
    indicator.innerHTML = '<span class="taskeePullRefreshSpinner" aria-hidden="true"></span><span class="taskeePullRefreshText">Pull to refresh</span>'
    document.body.appendChild(indicator)
  }
  return indicator
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

function isAtTop(scrollable: HTMLElement | null) {
  if (scrollable) return scrollable.scrollTop <= 0
  return rootScrollTop() <= 0
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, select, [contenteditable="true"]')
}

function setIndicatorState(indicator: HTMLDivElement, state: 'idle' | 'pull' | 'ready' | 'refreshing', distance = 0) {
  indicator.dataset.state = state === 'idle' ? '' : state
  const text = indicator.querySelector<HTMLSpanElement>('.taskeePullRefreshText')

  if (state === 'ready') {
    if (text) text.textContent = 'Release to refresh'
  } else if (state === 'refreshing') {
    if (text) text.textContent = 'Refreshing…'
  } else {
    if (text) text.textContent = 'Pull to refresh'
  }

  if (state === 'idle') {
    indicator.style.transform = 'translate3d(-50%, -70px, 0) scale(0.96)'
    indicator.style.opacity = '0'
    return
  }

  const y = Math.min(MAX_PULL_DISTANCE, Math.max(0, distance))
  const scale = state === 'ready' || state === 'refreshing' ? 1 : 0.96 + Math.min(0.04, y / 2400)
  indicator.style.opacity = String(Math.min(1, 0.25 + y / 70))
  indicator.style.transform = `translate3d(-50%, ${Math.max(-52, -58 + y)}px, 0) scale(${scale})`
}

function installPullToRefresh() {
  if (typeof window === 'undefined') return
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return
  if ((window as any).__taskeePullToRefreshInstalled) return
  ;(window as any).__taskeePullToRefreshInstalled = true

  document.documentElement.classList.remove('taskeeNoPullRefresh')
  installPullRefreshStyles()
  const indicator = ensureIndicator()

  let startX = 0
  let startY = 0
  let pulling = false
  let refreshing = false
  let pullDistance = 0
  let activeScrollable: HTMLElement | null = null

  const reset = () => {
    if (refreshing) return
    pulling = false
    pullDistance = 0
    window.setTimeout(() => setIndicatorState(indicator, 'idle'), 40)
  }

  const onTouchStart = (event: TouchEvent) => {
    if (refreshing || event.touches.length !== 1 || isEditableTarget(event.target)) return
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    activeScrollable = nearestScrollableY(event.target instanceof Element ? event.target : null)
    pulling = false
    pullDistance = 0
  }

  const onTouchMove = (event: TouchEvent) => {
    if (refreshing || event.touches.length !== 1 || isEditableTarget(event.target)) return

    const touch = event.touches[0]
    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    if (Math.abs(deltaY) < TOUCH_DELTA_THRESHOLD) return
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) return

    if (deltaY <= 0) {
      reset()
      return
    }

    const scrollable = activeScrollable || nearestScrollableY(event.target instanceof Element ? event.target : null)
    if (!isAtTop(scrollable)) return

    // The app uses nested scroll containers on many pages, so browser-native
    // pull-to-refresh does not reliably fire. Prevent the rubber-band gesture
    // and perform an app-level reload when the user pulls far enough.
    event.preventDefault()
    pulling = true
    pullDistance = Math.min(MAX_PULL_DISTANCE, deltaY * 0.62)
    setIndicatorState(indicator, pullDistance >= REFRESH_THRESHOLD ? 'ready' : 'pull', pullDistance)
  }

  const onTouchEnd = () => {
    if (!pulling || refreshing) return

    if (pullDistance >= REFRESH_THRESHOLD) {
      refreshing = true
      setIndicatorState(indicator, 'refreshing', REFRESH_THRESHOLD)
      window.setTimeout(() => window.location.reload(), 120)
      return
    }

    reset()
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
  document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
  document.addEventListener('touchcancel', reset, { passive: true, capture: true })
}

installPullToRefresh()
