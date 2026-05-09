import React, { useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { apiFetch } from './lib/api'

type DashData = {
  tasks?: {
    total?: number
    pending?: number
    in_progress?: number
    submitted?: number
    completed?: number
    overdue?: number
    cancelled?: number
    completion_rate?: number
    due_today?: number
    due_week?: number
  }
  trend?: Array<{ day?: string; label?: string; completed?: number; overdue?: number; created?: number }>
  priority?: Record<string, number>
  velocity?: Array<{ week?: string; week_start?: string; created?: number; completed?: number }>
}

const chartClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 90_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: 1,
    },
  },
})

const COLORS = {
  created: '#e2ab41',
  completed: '#22c55e',
  overdue: '#ef4444',
  review: '#38bdf8',
  progress: '#8b5cf6',
  pending: '#f97316',
}

function n(v: unknown) {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

function buildPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const cp1x = p0.x + (p1.x - p0.x) / 2
    const cp2x = p0.x + (p1.x - p0.x) / 2
    d += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
}

function ModernRealtimeDashboardChart() {
  const q = useQuery({
    queryKey: ['dashboard-modern-realtime-chart'],
    queryFn: () => apiFetch<DashData>('/api/v1/stats/dashboard'),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  const data = q.data
  const tasks = data?.tasks || {}
  const trend = useMemo(() => (data?.trend || []).slice(-14), [data])
  const priority = data?.priority || {}
  const maxTrend = Math.max(1, ...trend.flatMap(d => [n(d.created), n(d.completed), n(d.overdue)]))

  const vb = { w: 920, h: 360, l: 46, r: 20, t: 24, b: 44 }
  const cw = vb.w - vb.l - vb.r
  const ch = vb.h - vb.t - vb.b
  const point = (value: number, idx: number) => ({
    x: vb.l + (idx / Math.max(trend.length - 1, 1)) * cw,
    y: vb.t + ch - (value / maxTrend) * ch,
  })

  const createdPts = trend.map((d, i) => point(n(d.created), i))
  const completedPts = trend.map((d, i) => point(n(d.completed), i))
  const overduePts = trend.map((d, i) => point(n(d.overdue), i))
  const createdPath = buildPath(createdPts)
  const completedPath = buildPath(completedPts)
  const overduePath = buildPath(overduePts)
  const completedArea = completedPath && completedPts.length
    ? `${completedPath} L ${completedPts[completedPts.length - 1].x} ${vb.h - vb.b} L ${vb.l} ${vb.h - vb.b} Z`
    : ''
  const createdArea = createdPath && createdPts.length
    ? `${createdPath} L ${createdPts[createdPts.length - 1].x} ${vb.h - vb.b} L ${vb.l} ${vb.h - vb.b} Z`
    : ''

  const total = n(tasks.total)
  const completeRate = Math.max(0, Math.min(100, n(tasks.completion_rate)))
  const completed = n(tasks.completed)
  const overdue = n(tasks.overdue)
  const active = n(tasks.in_progress) + n(tasks.submitted)
  const pending = n(tasks.pending)
  const createdTotal = trend.reduce((s, d) => s + n(d.created), 0)
  const completedTotal = trend.reduce((s, d) => s + n(d.completed), 0)
  const overdueTotal = trend.reduce((s, d) => s + n(d.overdue), 0)

  const riskRows = [
    { label: 'Critical', value: n(priority.critical), color: COLORS.overdue },
    { label: 'High', value: n(priority.high), color: COLORS.pending },
    { label: 'Medium', value: n(priority.medium), color: COLORS.progress },
    { label: 'Low', value: n(priority.low), color: COLORS.review },
  ]
  const riskMax = Math.max(1, ...riskRows.map(r => r.value))

  if (q.isError) {
    return <div className="dashboardModernCard"><div className="dashboardModernError">Unable to load live dashboard data.</div></div>
  }

  return (
    <div className="dashboardModernCard">
      <div className="dashboardModernHead">
        <div>
          <div className="dashboardModernKicker">Modern realtime operations view</div>
          <div className="dashboardModernTitle">Task flow, throughput, and risk signal</div>
          <div className="dashboardModernSub">
            Live dashboard data refreshed every 30 seconds. The view combines task creation, completion, overdue exposure, completion health, and priority risk in one responsive visualization.
          </div>
        </div>
        <div className="dashboardModernLive"><span className="dashboardModernLiveDot" />Live · 30s refresh</div>
      </div>

      {q.isLoading ? (
        <div className="dashboardModernEmpty">Loading realtime chart…</div>
      ) : !trend.length ? (
        <div className="dashboardModernEmpty">No trend data available yet.</div>
      ) : (
        <div className="dashboardModernGrid">
          <div className="dashboardModernChartPanel">
            <div className="dashboardModernChartTop">
              <div className="dashboardModernLegend">
                <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: COLORS.created, color: COLORS.created }} />Created</span>
                <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: COLORS.completed, color: COLORS.completed }} />Completed</span>
                <span className="dashboardModernLegendItem"><span className="dashboardModernSwatch" style={{ background: COLORS.overdue, color: COLORS.overdue }} />Overdue</span>
              </div>
              <div className="dashboardModernMetric">14-day throughput · {createdTotal} created / {completedTotal} completed</div>
            </div>
            <div className="dashboardModernSvgWrap">
              <svg className="dashboardModernSvg" viewBox={`0 0 ${vb.w} ${vb.h}`} preserveAspectRatio="none" aria-label="Realtime task flow chart">
                <defs>
                  <linearGradient id="modernCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.created} stopOpacity="0.32" />
                    <stop offset="90%" stopColor={COLORS.created} stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="modernCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.completed} stopOpacity="0.28" />
                    <stop offset="90%" stopColor={COLORS.completed} stopOpacity="0.02" />
                  </linearGradient>
                  <filter id="modernGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {[0, 0.25, 0.5, 0.75, 1].map((p) => {
                  const y = vb.t + ch * (1 - p)
                  return <line key={p} x1={vb.l} y1={y} x2={vb.w - vb.r} y2={y} stroke="rgba(255,255,255,0.09)" strokeDasharray={p === 0 ? '0' : '6 8'} />
                })}

                {trend.map((d, i) => {
                  const slot = cw / Math.max(trend.length - 1, 1)
                  const x = vb.l + i * slot
                  const label = String(d.label || d.day || '').slice(0, 5)
                  return <text key={i} x={x} y={vb.h - 15} textAnchor="middle" fill="var(--muted)" fontSize="11" fontWeight="800">{label}</text>
                })}

                {createdArea && <path d={createdArea} fill="url(#modernCreated)" />}
                {completedArea && <path d={completedArea} fill="url(#modernCompleted)" />}
                {createdPath && <path d={createdPath} fill="none" stroke={COLORS.created} strokeWidth="4" strokeLinecap="round" filter="url(#modernGlow)" />}
                {completedPath && <path d={completedPath} fill="none" stroke={COLORS.completed} strokeWidth="4" strokeLinecap="round" filter="url(#modernGlow)" />}
                {overduePath && <path d={overduePath} fill="none" stroke={COLORS.overdue} strokeWidth="3" strokeLinecap="round" strokeDasharray="8 8" />}

                {trend.map((d, i) => {
                  const p = completedPts[i]
                  return <circle key={i} cx={p.x} cy={p.y} r="4" fill={COLORS.completed} stroke="rgba(10,12,18,0.85)" strokeWidth="2" />
                })}
              </svg>
            </div>
          </div>

          <div className="dashboardModernSidePanel">
            <div className="dashboardModernScore">
              <div className="dashboardModernGauge" style={{ '--pct': completeRate } as React.CSSProperties}>
                <div className="dashboardModernGaugeInner">
                  <div>
                    <div className="dashboardModernGaugeValue">{completeRate}%</div>
                    <div className="dashboardModernGaugeLabel">complete</div>
                  </div>
                </div>
              </div>
              <div className="dashboardModernStats">
                <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Total tasks</span><span className="dashboardModernStatValue">{total}</span></div>
                <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Active / review</span><span className="dashboardModernStatValue">{active}</span></div>
                <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Completed</span><span className="dashboardModernStatValue">{completed}</span></div>
                <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Overdue</span><span className="dashboardModernStatValue">{overdue}</span></div>
              </div>
            </div>

            <div className="dashboardModernRisk">
              {riskRows.map((row) => (
                <div className="dashboardModernRiskRow" key={row.label}>
                  <div className="dashboardModernRiskLabel">{row.label}</div>
                  <div className="dashboardModernRiskTrack"><div className="dashboardModernRiskFill" style={{ '--w': `${Math.round((row.value / riskMax) * 100)}%`, '--c': row.color } as React.CSSProperties} /></div>
                  <div className="dashboardModernRiskValue">{row.value}</div>
                </div>
              ))}
            </div>

            <div className="dashboardModernStat"><span className="dashboardModernStatLabel">Pending queue</span><span className="dashboardModernStatValue">{pending}</span></div>
            <div className="dashboardModernStat"><span className="dashboardModernStatLabel">14-day overdue hits</span><span className="dashboardModernStatValue">{overdueTotal}</span></div>
          </div>
        </div>
      )}
    </div>
  )
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function shouldMount() {
  return window.location.pathname === '/app/dashboard'
}

function findInsertionPoint() {
  const content = document.querySelector('.contentV4')
  if (!content) return null
  const onboarding = content.querySelector('.onboardingBanner')
  if (onboarding?.parentElement) return onboarding.parentElement
  return content.firstElementChild?.parentElement || content
}

function ensureModernDashboardChart() {
  if (!shouldMount()) {
    root?.unmount()
    root = null
    host?.remove()
    host = null
    return
  }

  const parent = findInsertionPoint()
  if (!parent) return

  if (!host || !document.body.contains(host)) {
    host = document.createElement('div')
    host.className = 'dashboardModernHost'
  }

  const marker = parent.querySelector('.pageHeaderCard')
  if (marker?.nextSibling) parent.insertBefore(host, marker.nextSibling)
  else parent.prepend(host)

  if (!root) {
    root = createRoot(host)
    root.render(
      <QueryClientProvider client={chartClient}>
        <ModernRealtimeDashboardChart />
      </QueryClientProvider>,
    )
  }
}

const observer = new MutationObserver(() => ensureModernDashboardChart())

window.addEventListener('load', ensureModernDashboardChart)
window.addEventListener('popstate', () => setTimeout(ensureModernDashboardChart, 80))
window.addEventListener('taskee:route-change', () => setTimeout(ensureModernDashboardChart, 80))

setInterval(ensureModernDashboardChart, 750)
setTimeout(() => {
  observer.observe(document.body, { childList: true, subtree: true })
  ensureModernDashboardChart()
}, 0)
