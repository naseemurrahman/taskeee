import { useMemo, useState, useEffect, useRef } from 'react'
import { IconAward } from '../../components/ui/AppIcons'
import type React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canViewAnalytics } from '../../lib/rbac'
import { OnboardingBanner } from '../../components/OnboardingBanner'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { Modal } from '../../components/Modal'
import { useRealtimeInvalidation } from '../../lib/socket'
import {
  ClipboardList, Zap, CheckCircle2, AlertTriangle, Send, FolderOpen,
  LayoutDashboard, TrendingUp, TrendingDown, Minus
} from 'lucide-react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'

// ── Modern Task Activity Chart ─────────────────────────────────────────────────
interface ActivityPoint { day: string; label: string; completed: number; overdue: number; created: number }

function TaskActivityChart({ data }: { data: ActivityPoint[] }) {
  if (!data.length) {
    return (
      <div style={{ height: 220, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No activity data yet — tasks will appear here as work begins
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    label: d.label || d.day.slice(5),
    net: d.completed - d.created,
  }))

  const totalCreated   = data.reduce((s, d) => s + d.created, 0)
  const totalCompleted = data.reduce((s, d) => s + d.completed, 0)
  const totalOverdue   = data.reduce((s, d) => s + d.overdue, 0)
  const trend = totalCompleted >= totalCreated ? 'up' : totalCompleted >= totalCreated * 0.7 ? 'neutral' : 'down'

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(226,171,65,0.25)',
        borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontSize: 12, minWidth: 150,
      }}>
        <div style={{ fontWeight: 900, color: 'var(--text)', marginBottom: 8, fontSize: 13 }}>{label}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
            <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span>
            <span style={{ color: '#fff', fontWeight: 900 }}>{p.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* KPI strip above chart */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Created', value: totalCreated, color: '#e2ab41', icon: '＋' },
          { label: 'Completed', value: totalCompleted, color: '#22c55e', icon: '✓' },
          { label: 'Overdue', value: totalOverdue, color: '#ef4444', icon: '⚠' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{
            flex: '1 1 80px', padding: '10px 14px', borderRadius: 12,
            background: `linear-gradient(135deg, ${color}18, ${color}08)`,
            border: `1px solid ${color}30`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
              {icon} {label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 950, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
          </div>
        ))}
        <div style={{
          flex: '1 1 80px', padding: '10px 14px', borderRadius: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            Trend
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {trend === 'up'
              ? <TrendingUp size={18} color="#22c55e" />
              : trend === 'neutral'
              ? <Minus size={18} color="#e2ab41" />
              : <TrendingDown size={18} color="#ef4444" />}
            <span style={{ fontSize: 13, fontWeight: 800, color: trend === 'up' ? '#22c55e' : trend === 'neutral' ? '#e2ab41' : '#ef4444' }}>
              {trend === 'up' ? 'On track' : trend === 'neutral' ? 'Moderate' : 'Behind'}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts composite chart — responsive, real data */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={formatted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e2ab41" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#e2ab41" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--muted)', fontSize: 10, fontWeight: 700 }}
            axisLine={false} tickLine={false}
            interval="preserveStartEnd"
            label={{ value: 'Date', position: 'insideBottom', offset: -4, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis
            tick={{ fill: 'var(--muted)', fontSize: 10, fontWeight: 700 }}
            axisLine={false} tickLine={false} allowDecimals={false}
            width={42}
            label={{ value: 'Tasks', angle: -90, position: 'insideLeft', offset: 14, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle" iconSize={8}
            formatter={(v) => <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>{v}</span>}
          />
          {/* Filled areas */}
          <Area type="monotone" dataKey="created"   name="Created"   fill="url(#gradCreated)"   stroke="#e2ab41" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="completed" name="Completed" fill="url(#gradCompleted)" stroke="#22c55e" strokeWidth={2} dot={false} />
          {/* Overdue as a line */}
          <Line  type="monotone" dataKey="overdue"   name="Overdue"   stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />
          {/* Zero reference */}
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function VelocityBars({ data }: { data: Array<{ week: string; created: number; completed: number }> }) {
  if (!data.length) return null
  const maxVal = Math.max(...data.flatMap(d => [d.created, d.completed]), 1)
  const VW = 600, VH = 180
  const padT = 14, padB = 36, padL = 32, padR = 12
  const chartW = VW - padL - padR
  const chartH = VH - padT - padB
  const n = data.length
  const slotW = chartW / n
  const barW = Math.min(slotW * 0.35, 28)
  const gap = barW * 0.3

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none"
      style={{ width: '100%', height: VH, display: 'block' }}>
      {/* Gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map(p => {
        const y = padT + chartH * (1 - p)
        return (
          <g key={p}>
            <line x1={padL} y1={y} x2={VW - padR} y2={y}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray={p === 0 ? "0" : "5 5"} />
            {p > 0 && (
              <text x={padL - 5} y={y + 4} textAnchor="end"
                fill="var(--muted)" fontSize={11} fontWeight="600">
                {Math.round(maxVal * p)}
              </text>
            )}
          </g>
        )
      })}
      {/* Bars spread evenly */}
      {data.map((d, i) => {
        const cx = padL + i * slotW + slotW / 2
        const bh1 = Math.max(3, (d.created / maxVal) * chartH)
        const bh2 = Math.max(3, (d.completed / maxVal) * chartH)
        const x1 = cx - gap / 2 - barW
        const x2 = cx + gap / 2
        const label = String(d.week || '').slice(5, 10)
        return (
          <g key={i}>
            <rect x={x1} y={padT + chartH - bh1} width={barW} height={bh1}
              fill="#e2ab41" rx={3} opacity={0.92} />
            <rect x={x2} y={padT + chartH - bh2} width={barW} height={bh2}
              fill="#22c55e" rx={3} opacity={0.92} />
            <text x={cx} y={VH - padB + 18} textAnchor="middle"
              fill="var(--muted)" fontSize={11} fontWeight="600">
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Types ────────────────────────────────────────────────────────
type DashData = {
  tasks: {
    total: number; pending: number; in_progress: number; submitted: number
    completed: number; overdue: number; cancelled: number
    completion_rate: number; due_today: number; due_week: number
  }
  trend: Array<{ day: string; label: string; completed: number; overdue: number; created: number }>
  projects: Array<{
    id: string; name: string; color?: string | null; total: number
    completed: number; overdue: number; in_progress: number; pending: number; progress: number
  }>
  leaderboard: Array<{
    id: string; name: string; total: number; completed: number
    overdue: number; in_progress: number; completion_rate: number; score: number
  }>
  priority: Record<string, number>
  velocity: Array<{ week: string; week_start: string; created: number; completed: number }>
}

async function fetchDash(): Promise<DashData> {
  return apiFetch<DashData>('/api/v1/stats/dashboard')
}

// ─── Design tokens ────────────────────────────────────────────────
const C = {
  brand: '#e2ab41', purple: '#8B5CF6', blue: '#38bdf8',
  green: '#22c55e', red: '#ef4444', orange: '#f97316',
  teal: '#14b8a6', muted: 'var(--muted)',
}

// ─── Animated counter ─────────────────────────────────────────────
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const target = value
    const start = prev.current
    const diff = target - start
    if (diff === 0) return
    const steps = 30
    let step = 0
    const t = setInterval(() => {
      step++
      setDisplay(Math.round(start + (diff * step) / steps))
      if (step >= steps) { clearInterval(t); prev.current = target }
    }, 16)
    return () => clearInterval(t)
  }, [value])
  return <>{display}{suffix}</>
}

// ─── Smooth area sparkline ────────────────────────────────────────

// ─── Donut ring ────────────────────────────────────────────────────
function DonutRing({ segments, size = 120, strokeW = 12 }: {
  segments: { value: number; color: string; label: string }[]
  size?: number; strokeW?: number
}) {
  const total = segments.reduce((s, d) => s + d.value, 0)
  if (!total) return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '2px dashed var(--border)', display: 'grid', placeItems: 'center' }}>
      <span style={{ fontSize: 11, color: C.muted }}>No data</span>
    </div>
  )
  const r = (size - strokeW) / 2
  const circ = 2 * Math.PI * r
  const cx = size / 2, cy = size / 2
  let offset = 0
  const segs = segments.filter(s => s.value > 0).map(s => {
    const dash = (s.value / total) * circ
    const seg = { ...s, dash, offset, pct: Math.round((s.value / total) * 100) }
    offset += dash + 1
    return seg
  })

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg2)" strokeWidth={strokeW} />
      {segs.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
          stroke={s.color} strokeWidth={strokeW - 1}
          strokeDasharray={`${s.dash} ${circ}`}
          strokeDashoffset={-s.offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      ))}
    </svg>
  )
}

// ─── Horizontal progress bar ─────────────────────────────────────
function ProgressRow({ label, value, max, color, sub }: {
  label: string; value: number; max: number; color: string; sub?: string
}) {
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--text)' }}>{value}</span>
          {sub && <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>{sub}</span>}
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--bg2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>
    </div>
  )
}

// ─── Mini bar chart ───────────────────────────────────────────────
// BarChart replaced by Recharts in Weekly Velocity section

// ─── Card wrapper ─────────────────────────────────────────────────
function Card({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── KPI Tile ─────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color, icon }: {
  label: string; value: number; sub?: string; color: string; icon: React.ReactNode
}) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px 18px', position: 'relative', overflow: 'hidden', flex: '1 1 130px', minWidth: 130 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: '18px 18px 0 0' }} />
      {/* Lucide icon — watermark in corner */}
      <div style={{ position: 'absolute', bottom: 12, right: 14, opacity: 0.08, color, lineHeight: 1, userSelect: 'none', pointerEvents: 'none' }}>
        <span style={{ display: 'flex' }}>{icon}</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 950, color: 'var(--text)', letterSpacing: '-1.5px', lineHeight: 1 }}>
        <AnimatedNumber value={value} />
      </div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 5, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────
export function DashboardHomePage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const canOpenChartDetails = canCreateTasksAndProjects(me?.role)
  const canOpenAdvancedDetails = canViewAnalytics(me?.role)
  const [createOpen, setCreateOpen] = useState(false)
  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })
  const [chartDetail, setChartDetail] = useState<null | 'activity' | 'status' | 'priority' | 'projects' | 'velocity' | 'team' | 'workload'>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDash,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  const tasks       = data?.tasks
  const projects    = useMemo(() => data?.projects    || [], [data])
  const leaderboard = useMemo(() => data?.leaderboard || [], [data])
  const trendData    = useMemo(() => (data?.trend || []).slice(-14), [data])
  const velocity = useMemo(() => {
    const raw = (data?.velocity || []).slice(-8)
    if (raw.length > 0) return raw.map(v => ({ ...v, label: v.week }))
    // Baseline: last 8 weeks with zeros so chart always renders
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (7 - i) * 7)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { week: label, week_start: d.toISOString().slice(0, 10), created: 0, completed: 0, label }
    })
  }, [data])

  const statusSegs = useMemo(() => {
    if (!tasks) return []
    return [
      { label: 'In Progress', value: tasks.in_progress, color: C.purple },
      { label: 'Submitted',   value: tasks.submitted,   color: C.blue },
      { label: 'Completed',   value: tasks.completed,   color: C.green },
      { label: 'Overdue',     value: tasks.overdue,     color: C.red },
      { label: 'Pending',     value: tasks.pending,     color: C.brand },
    ].filter(s => s.value > 0)
  }, [tasks])

  const priorityRows = useMemo(() => {
    const p = data?.priority || {}
    return [['critical', C.red], ['high', C.orange], ['medium', C.purple], ['low', C.blue]]
      .map(([k, c]) => ({ label: k, value: Number(p[k] || 0), color: c as string }))
      .filter(e => e.value > 0)
  }, [data])

  const Skel = ({ h = 80 }: { h?: number }) => (
    <div className="skeleton" style={{ height: h, borderRadius: 14 }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <LayoutDashboard size={20} strokeWidth={2} />
              Dashboard
            </div>
            <div className="pageHeaderCardSub">
              AI-powered real-time analytics • {tasks?.total || 0} tasks across {projects.length} projects • Auto-refreshes every 30s
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.22)' }}>● Live data</span>
              {!!tasks?.overdue && <span className="pageHeaderCardTag" style={{ color: C.red, background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }}>⚠ {tasks.overdue} overdue</span>}
              {tasks?.completion_rate !== undefined && <span className="pageHeaderCardTag" style={{ color: C.green, background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.22)' }}>✓ {tasks.completion_rate}% complete</span>}
            </div>
          </div>
        </div>
      </div>

      <OnboardingBanner />

      {/* ── KPI Row ── */}
      <div className="dashKpiStrip">
        {isLoading ? [1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 18, flex: '1 1 130px', minWidth: 130 }} />) : <>
          <KpiTile label="Total Tasks"    value={tasks?.total || 0}       color={C.brand}  icon={<ClipboardList size={36} />} sub={`${tasks?.due_today||0} due today`} />
          <KpiTile label="In Progress"    value={tasks?.in_progress || 0} color={C.purple} icon={<Zap size={36} />}           sub="active work" />
          <KpiTile label="Completed"      value={tasks?.completed || 0}   color={C.green}  icon={<CheckCircle2 size={36} />}  sub={`${tasks?.completion_rate||0}% rate`} />
          <KpiTile label="Overdue"        value={tasks?.overdue || 0}     color={C.red}    icon={<AlertTriangle size={36} />} sub={`${tasks?.due_week||0} due this week`} />
          <KpiTile label="Pending Review" value={tasks?.submitted || 0}   color={C.blue}   icon={<Send size={36} />}          sub="awaiting approval" />
          <KpiTile label="Projects"       value={projects.length}         color={C.teal}   icon={<FolderOpen size={36} />}    sub={`${projects.filter(p=>p.progress===100).length} complete`} />
        </>}
      </div>

      {/* ── Row 1: Activity (wide) + Status Donut + Priority side-by-side ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
        <Card
          title="Task Activity — Last 14 Days"
          sub="Created · Completed · Overdue by day"
          action={canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('activity')}>Details</button> : undefined}
        >
          {isLoading ? <Skel h={280} /> : (
            <TaskActivityChart data={trendData} />
          )}
        </Card>

        <Card
          title="Task Status"
          sub="Current distribution"
          action={canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('status')}>Details</button> : undefined}
        >
          {isLoading ? <Skel h={180} /> : (
            <div
              role="button"
              tabIndex={canOpenChartDetails ? 0 : -1}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, cursor: canOpenChartDetails ? 'pointer' : 'default' }}
              onClick={() => canOpenChartDetails ? setChartDetail('status') : null}
              onKeyDown={(e) => (canOpenChartDetails && e.key === 'Enter' ? setChartDetail('status') : null)}
            >
              <div style={{ position: 'relative' }}>
                <DonutRing segments={statusSegs} size={120} strokeW={13} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 26, fontWeight: 950, color: 'var(--text)', lineHeight: 1 }}>{tasks?.total || 0}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>tasks</div>
                </div>
              </div>
              <div style={{ width: '100%', display: 'grid', gap: 5 }}>
                {statusSegs.map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>{s.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text)' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Priority Breakdown"
          sub="Tasks by urgency level"
          action={canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('priority')}>Details</button> : undefined}
        >
          {isLoading ? <Skel h={120} /> : (() => {
            const entries = priorityRows
            if (!entries.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No tasks yet</div>
            const max = Math.max(...entries.map(e => e.value))
            return (
              <div
                role="button"
                tabIndex={canOpenChartDetails ? 0 : -1}
                style={{ display: 'grid', gap: 10, cursor: canOpenChartDetails ? 'pointer' : 'default' }}
                onClick={() => canOpenChartDetails ? setChartDetail('priority') : null}
                onKeyDown={(e) => (canOpenChartDetails && e.key === 'Enter' ? setChartDetail('priority') : null)}
              >
                {entries.map(e => (
                  <ProgressRow key={e.label} label={e.label.charAt(0).toUpperCase()+e.label.slice(1)} value={e.value} max={max} color={e.color} />
                ))}
              </div>
            )
          })()}
        </Card>
      </div>

      {/* ── Row 2: Project Progress full-width ── */}
      <Card title="Project Progress" sub="Completion % per active project"
        action={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('projects')}>Details</button> : null}
          <Link to="/app/projects" style={{ fontSize: 11, color: C.brand, fontWeight: 800, textDecoration: 'none' }}>All →</Link>
        </div>}>
        {isLoading ? <Skel h={200} /> : !projects.length ? (
          <div style={{ height: 80, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 13 }}>No projects yet</div>
        ) : (
          <div
            role="button"
            tabIndex={canOpenChartDetails ? 0 : -1}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px 24px', cursor: canOpenChartDetails ? 'pointer' : 'default' }}
            onClick={() => canOpenChartDetails ? setChartDetail('projects') : null}
            onKeyDown={(e) => (canOpenChartDetails && e.key === 'Enter' ? setChartDetail('projects') : null)}
          >
            {projects.slice(0, 8).map((p, i) => {
              const color = p.color || [C.brand, C.purple, C.blue, C.teal, C.orange, C.green][i % 6]
              return (
                <div key={p.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: C.muted }}>{p.completed}/{p.total}</span>
                      <span style={{ fontSize: 14, fontWeight: 950, color: p.progress === 100 ? C.green : p.overdue > 0 ? C.red : 'var(--text)', minWidth: 36, textAlign: 'right' }}>{p.progress}%</span>
                    </div>
                  </div>
                  <div style={{ height: 7, borderRadius: 999, background: 'var(--bg2)', display: 'flex', overflow: 'hidden', gap: 0 }}>
                    <div style={{ flex: p.completed, background: C.green, transition: 'flex 0.8s ease' }} />
                    <div style={{ flex: p.in_progress, background: color, opacity: 0.7, transition: 'flex 0.8s ease' }} />
                    <div style={{ flex: p.overdue, background: C.red, transition: 'flex 0.8s ease' }} />
                    <div style={{ flex: p.pending, background: 'var(--border)', transition: 'flex 0.8s ease' }} />
                  </div>
                  {p.overdue > 0 && <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginTop: 3 }}>⚠ {p.overdue} overdue</div>}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Row 3: Weekly velocity (full Recharts) ── */}
      <div className="dashGrid21" style={{ alignItems: 'start' }}>
        <Card
          title="Weekly Velocity"
          sub="Tasks created vs. completed per week"
          action={canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('velocity')}>Details</button> : undefined}
        >
          {isLoading ? <Skel h={180} /> : (
            <div>
              {/* Summary row */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Created', color: C.brand, key: 'created' },
                  { label: 'Completed', color: C.green, key: 'completed' },
                ].map(m => {
                  const total = velocity.reduce((s, v) => s + (v as any)[m.key], 0)
                  const avg = Math.round(total / velocity.length)
                  return (
                    <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{m.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--text)' }}>avg {avg}/wk</span>
                    </div>
                  )
                })}
                {(() => {
                  const lastCreated = velocity[velocity.length-1]?.created || 0
                  const lastDone = velocity[velocity.length-1]?.completed || 0
                  const net = lastDone - lastCreated
                  return (
                    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: net >= 0 ? C.green : C.red, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {net >= 0 ? '▲' : '▼'} Net {Math.abs(net)} this week
                    </span>
                  )
                })()}
              </div>
              {/* Custom SVG bar chart */}
              <div style={{ marginTop: 4, minHeight: 140 }}>
                <VelocityBars data={velocity} />
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                {[{ color: '#e2ab41', label: 'Created' }, { color: '#22c55e', label: 'Completed' }].map(m => (
                  <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Velocity insight panel */}
        <Card title="Throughput Insights" sub="Based on recent velocity trend">
          {isLoading ? <Skel h={180} /> : (
            <div style={{ display: 'grid', gap: 14 }}>
              {(() => {
                if (!velocity.length) return <div style={{ color: C.muted, fontSize: 13 }}>No velocity data yet</div>
                const totalCreated = velocity.reduce((s, v) => s + v.created, 0)
                const totalDone = velocity.reduce((s, v) => s + v.completed, 0)
                const avgCreated = Math.round(totalCreated / velocity.length)
                const avgDone = Math.round(totalDone / velocity.length)
                const backlogGrowth = totalCreated - totalDone
                const throughputRatio = totalCreated ? Math.round((totalDone / totalCreated) * 100) : 0
                const recentW = velocity.slice(-3)
                const recentTrend = recentW.length > 1
                  ? recentW[recentW.length-1].completed - recentW[0].completed
                  : 0
                const metrics = [
                  { label: 'Throughput rate', value: `${throughputRatio}%`, color: throughputRatio >= 80 ? C.green : throughputRatio >= 60 ? C.brand : C.red, desc: 'completed / created' },
                  { label: 'Avg created/wk', value: avgCreated, color: C.brand, desc: 'new tasks per week' },
                  { label: 'Avg completed/wk', value: avgDone, color: C.green, desc: 'tasks shipped per week' },
                  { label: 'Net backlog', value: backlogGrowth > 0 ? `+${backlogGrowth}` : backlogGrowth, color: backlogGrowth > 0 ? C.red : C.green, desc: backlogGrowth > 0 ? 'backlog growing' : 'keeping up' },
                  { label: 'Recent trend', value: recentTrend > 0 ? `↑ ${recentTrend}` : recentTrend < 0 ? `↓ ${Math.abs(recentTrend)}` : '→ steady', color: recentTrend > 0 ? C.green : recentTrend < 0 ? C.red : C.muted, desc: 'completions last 3 weeks' },
                ]
                return metrics.map(m => (
                  <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{m.desc}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 950, color: m.color }}>{m.value}</div>
                  </div>
                ))
              })()}
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 4: Team Performance + At-Risk side-by-side ── */}
      <div className="dashGrid2">
        <Card title="Team Performance" sub="Completion rate — tasks finished / assigned"
          action={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('team')}>Details</button> : null}
            <Link to="/app/analytics" style={{ fontSize: 11, color: C.brand, fontWeight: 800, textDecoration: 'none' }}>Analytics →</Link>
          </div>}>
          {isLoading ? <Skel h={200} /> : !leaderboard.length ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>No team data yet</div>
          ) : (
            <div
              role="button"
              tabIndex={canOpenChartDetails ? 0 : -1}
              style={{ display: 'grid', gap: 10, cursor: canOpenChartDetails ? 'pointer' : 'default' }}
              onClick={() => canOpenChartDetails ? setChartDetail('team') : null}
              onKeyDown={(e) => (canOpenChartDetails && e.key === 'Enter' ? setChartDetail('team') : null)}
            >
              {leaderboard.slice(0, 6).map((u, i) => {
                const colors = [C.brand, C.purple, C.blue, C.teal, C.orange, C.green]
                const color = colors[i % colors.length]
                const rate = u.completion_rate || 0
                const rateColor = rate >= 75 ? C.green : rate >= 40 ? C.brand : C.red
                return (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 44px', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 9, background: color+'20', color, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0, border: `1.5px solid ${color}35` }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{u.name}</span>
                        <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>{u.completed}/{u.total} done</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: 'var(--bg2)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${rate}%`, background: rateColor, borderRadius: 999, transition: 'width 0.8s ease' }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 950, color: rateColor, textAlign: 'right' }}>{rate}%</div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="At-Risk Tasks" sub="Overdue items requiring immediate attention">
          <AtRiskList />
        </Card>
      </div>

      {/* ── Row 5: Team Workload (full-width stacked bars) ── */}
      <Card
        title="Team Workload"
        sub="Active · Overdue · Done per person"
        action={canOpenChartDetails ? <button type="button" className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 11 }} onClick={() => setChartDetail('workload')}>Details</button> : undefined}
      >
          {leaderboard.length === 0 ? (
            <div style={{ height: 80, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 13 }}>No data</div>
          ) : (
            <div
              role="button"
              tabIndex={canOpenChartDetails ? 0 : -1}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 24px', cursor: canOpenChartDetails ? 'pointer' : 'default' }}
              onClick={() => canOpenChartDetails ? setChartDetail('workload') : null}
              onKeyDown={(e) => (canOpenChartDetails && e.key === 'Enter' ? setChartDetail('workload') : null)}
            >
              {leaderboard.slice(0, 8).map((u, i) => {
                const active = Math.max(0, u.total - u.completed - (u.overdue || 0))
                if (u.total === 0) return null
                return (
                  <div key={u.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{u.name.split(' ')[0]}</span>
                      <span style={{ fontSize: 11, color: C.muted }}>{u.total} tasks</span>
                    </div>
                    <div style={{ height: 9, borderRadius: 999, background: 'var(--bg2)', display: 'flex', overflow: 'hidden', gap: 1 }}>
                      {u.completed > 0 && <div style={{ flex: u.completed, background: C.green, transition: 'flex 0.6s ease' }} />}
                      {active > 0 && <div style={{ flex: active, background: [C.brand, C.purple, C.blue, C.teal][i%4], opacity: 0.8, transition: 'flex 0.6s ease' }} />}
                      {(u.overdue||0) > 0 && <div style={{ flex: u.overdue, background: C.red, transition: 'flex 0.6s ease' }} />}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                      <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>{u.completed} done</span>
                      {active > 0 && <span style={{ fontSize: 10, color: C.brand, fontWeight: 700 }}>{active} active</span>}
                      {(u.overdue||0) > 0 && <span style={{ fontSize: 10, color: C.red, fontWeight: 700 }}>{u.overdue} overdue</span>}
                    </div>
                  </div>
                )
              }).filter(Boolean)}
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                {[['Done', C.green], ['Active', C.brand], ['Overdue', C.red]].map(([l, c]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
                    <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

      <Modal
        title={
          chartDetail === 'activity' ? 'Task Activity Details'
            : chartDetail === 'status' ? 'Task Status Details'
            : chartDetail === 'priority' ? 'Priority Breakdown Details'
            : chartDetail === 'projects' ? 'Project Progress Details'
            : chartDetail === 'velocity' ? 'Weekly Velocity Details'
            : chartDetail === 'team' ? 'Team Performance Details'
            : chartDetail === 'workload' ? 'Team Workload Details'
            : 'Chart details'
        }
        open={!!chartDetail}
        wide
        onClose={() => setChartDetail(null)}
        footer={<button type="button" className="btn btnPrimary" style={{ height: 38 }} onClick={() => setChartDetail(null)}>Close</button>}
      >
        {!canOpenAdvancedDetails ? (
          <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
            Detailed metrics are limited for your role. You can still use the dashboard cards for high-level status and trends.
          </div>
        ) : null}
        {chartDetail === 'activity' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {trendData.slice(-10).map((d) => (
              <div key={d.day} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{d.label}</div>
                <div>Created: <strong>{d.created}</strong></div>
                <div>Completed: <strong>{d.completed}</strong></div>
                <div>Overdue: <strong style={{ color: d.overdue > 0 ? C.red : 'inherit' }}>{d.overdue}</strong></div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'status' && tasks ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {statusSegs.map((s) => (
              <div key={s.label} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{s.label}</div>
                <div>{Math.round((s.value / Math.max(1, tasks.total)) * 100)}%</div>
                <div style={{ color: s.color, fontWeight: 900 }}>{s.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'priority' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {priorityRows.map((p) => (
              <div key={p.label} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{p.label}</div>
                <div style={{ color: p.color, fontWeight: 900 }}>{p.value}</div>
              </div>
            ))}
            {priorityRows.length === 0 ? <div style={{ color: C.muted }}>No priority data yet.</div> : null}
          </div>
        ) : null}
        {chartDetail === 'projects' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {projects.slice(0, 12).map((p) => (
              <div key={p.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr repeat(4, 1fr)', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div>Done: {p.completed}</div>
                <div>Active: {p.in_progress}</div>
                <div>Overdue: {p.overdue}</div>
                <div style={{ fontWeight: 900 }}>{p.progress}%</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'velocity' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {velocity.map((v) => (
              <div key={v.week} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{v.week}</div>
                <div>Created: {v.created}</div>
                <div>Done: {v.completed}</div>
                <div style={{ fontWeight: 900, color: v.completed - v.created >= 0 ? C.green : C.red }}>{v.completed - v.created >= 0 ? '+' : ''}{v.completed - v.created}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'team' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {leaderboard.slice(0, 12).map((u) => (
              <div key={u.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{u.name}</div>
                <div>Rate: {u.completion_rate}%</div>
                <div>Done: {u.completed}/{u.total}</div>
                <div style={{ fontWeight: 900 }}>Score {u.score}</div>
              </div>
            ))}
          </div>
        ) : null}
        {chartDetail === 'workload' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {leaderboard.slice(0, 12).map((u) => {
              const active = Math.max(0, u.total - u.completed - (u.overdue || 0))
              return (
                <div key={u.id} className="miniCard" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{u.name}</div>
                  <div>Done {u.completed}</div>
                  <div>Active {active}</div>
                  <div style={{ color: (u.overdue || 0) > 0 ? C.red : 'var(--text)' }}>Overdue {u.overdue || 0}</div>
                </div>
              )
            })}
          </div>
        ) : null}
      </Modal>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

// ─── At-risk task list ─────────────────────────────────────────────
type RTask = { id: string; title: string; status: string; priority?: string | null; due_date?: string | null; assigned_to_name?: string | null; category_name?: string | null }
function AtRiskList() {
  const { data } = useQuery({
    queryKey: ['dash-overdue'],
    queryFn: () => apiFetch<{ tasks?: RTask[] }>('/api/v1/tasks?limit=20&page=1&status=overdue').then(d => d.tasks || []),
    staleTime: 0, refetchOnWindowFocus: true,
  })
  const tasks = data || []
  if (!tasks.length) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}><IconAward size={14} /></div>
      <div style={{ fontWeight: 800, fontSize: 13 }}>All tasks on track!</div>
      <div style={{ fontSize: 11, marginTop: 3 }}>No overdue items.</div>
    </div>
  )
  const pCol: Record<string, string> = { critical: C.red, high: C.orange, medium: C.purple, low: C.blue }
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {tasks.slice(0, 8).map(t => {
        const numeric = Number(t.due_date)
        const due = t.due_date
          ? (!isNaN(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(t.due_date))
          : null
        const daysOverdue = (due && !isNaN(due.getTime()) && due.getFullYear() >= 2020 && due.getFullYear() <= 2040)
          ? Math.floor((Date.now() - due.getTime()) / 86400000)
          : null
        return (
          <div key={t.id} style={{ padding: '9px 12px', borderRadius: 11, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{t.assigned_to_name || '—'}{t.category_name ? ` · ${t.category_name}` : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
              {daysOverdue !== null && <span style={{ fontSize: 10, fontWeight: 900, color: C.red }}>{daysOverdue}d late</span>}
              {t.priority && <span style={{ fontSize: 9, fontWeight: 800, color: pCol[t.priority] || C.muted, textTransform: 'capitalize' }}>{t.priority}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
