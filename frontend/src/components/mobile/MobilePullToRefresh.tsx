import { useEffect, useRef, useState } from 'react'

const TOUCH_DELTA_THRESHOLD = 6
const REFRESH_THRESHOLD = 86
const MAX_PULL_DISTANCE = 128

type PullState = 'idle' | 'pull' | 'ready' | 'refreshing'

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

function indicatorText(state: PullState) {
  if (state === 'ready') return 'Release to refresh'
  if (state === 'refreshing') return 'Refreshing…'
  return 'Pull to refresh'
}

export function MobilePullToRefresh() {
  const [state, setState] = useState<PullState>('idle')
  const [distance, setDistance] = useState(0)
  const stateRef = useRef({
    startX: 0,
    startY: 0,
    pulling: false,
    refreshing: false,
    pullDistance: 0,
    activeScrollable: null as HTMLElement | null,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return

    const reset = () => {
      const refs = stateRef.current
      if (refs.refreshing) return
      refs.pulling = false
      refs.pullDistance = 0
      window.setTimeout(() => {
        setDistance(0)
        setState('idle')
      }, 40)
    }

    const onTouchStart = (event: TouchEvent) => {
      const refs = stateRef.current
      if (refs.refreshing || event.touches.length !== 1 || isEditableTarget(event.target)) return
      refs.startX = event.touches[0].clientX
      refs.startY = event.touches[0].clientY
      refs.activeScrollable = nearestScrollableY(event.target instanceof Element ? event.target : null)
      refs.pulling = false
      refs.pullDistance = 0
      setDistance(0)
    }

    const onTouchMove = (event: TouchEvent) => {
      const refs = stateRef.current
      if (refs.refreshing || event.touches.length !== 1 || isEditableTarget(event.target)) return

      const touch = event.touches[0]
      const deltaY = touch.clientY - refs.startY
      const deltaX = touch.clientX - refs.startX

      if (Math.abs(deltaY) < TOUCH_DELTA_THRESHOLD) return
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) return

      if (deltaY <= 0) {
        reset()
        return
      }

      const scrollable = refs.activeScrollable || nearestScrollableY(event.target instanceof Element ? event.target : null)
      if (!isAtTop(scrollable)) return

      event.preventDefault()
      refs.pulling = true
      refs.pullDistance = Math.min(MAX_PULL_DISTANCE, deltaY * 0.62)
      setDistance(refs.pullDistance)
      setState(refs.pullDistance >= REFRESH_THRESHOLD ? 'ready' : 'pull')
    }

    const onTouchEnd = () => {
      const refs = stateRef.current
      if (!refs.pulling || refs.refreshing) return

      if (refs.pullDistance >= REFRESH_THRESHOLD) {
        refs.refreshing = true
        setDistance(REFRESH_THRESHOLD)
        setState('refreshing')
        window.setTimeout(() => window.location.reload(), 120)
        return
      }

      reset()
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
    document.addEventListener('touchcancel', reset, { passive: true, capture: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart, true)
      document.removeEventListener('touchmove', onTouchMove, true)
      document.removeEventListener('touchend', onTouchEnd, true)
      document.removeEventListener('touchcancel', reset, true)
    }
  }, [])

  const y = Math.min(MAX_PULL_DISTANCE, Math.max(0, distance))
  const scale = state === 'ready' || state === 'refreshing' ? 1 : 0.96 + Math.min(0.04, y / 2400)
  const transform = state === 'idle'
    ? 'translate3d(-50%, -70px, 0) scale(0.96)'
    : `translate3d(-50%, ${Math.max(-52, -58 + y)}px, 0) scale(${scale})`
  const opacity = state === 'idle' ? 0 : Math.min(1, 0.25 + y / 70)

  return (
    <div
      className="taskeePullRefreshIndicator"
      data-state={state === 'idle' ? '' : state}
      role="status"
      aria-live="polite"
      style={{ transform, opacity }}
    >
      <span className="taskeePullRefreshSpinner" aria-hidden="true" />
      <span className="taskeePullRefreshText">{indicatorText(state)}</span>
    </div>
  )
}
