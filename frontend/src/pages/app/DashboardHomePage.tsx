import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { OnboardingBanner } from '../../components/OnboardingBanner'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'

// ─── Types ───────────────────────────────────────────────────────
type DashData = {
  tasks: {
    total: number; pending: number; in_progress: number; submitted: number
    completed: number; overdue: number; cancelled: number
    completion_rate: number; due_today: number; due_week: number
  }
  trend: Array<{ day: string; label: string; completed: number; overdue: number; created: number }>
  projects: Array<{
    id: string; name: string; color?: string | null; total: number
    completed: number; overdue: number; in_progress: number; pending: number
    progress: number; start_date: string; earliest_due?: string; latest_due?: string
  }>
  leaderboard: Array<{
    id: string; name: string; department?: string | null; role?: string | null
    total: number; completed: number; overdue: number; in_progress: number
    completion_rate: number; score: number
  }>
  priority: Record<string, number>
  velocity: Array<{ week: string; week_start: string; created: number; completed: number }>
  projectStatusChart: Array<Record<string, any>>
}

async function fetchDash(): Promise<DashData> {
  return apiFetch<DashData>('/api/v1/stats/dashboard')
}

const C = {
  brand: '#e2ab41', purple: '#8B5CF6', blue: '#38bdf8', green: '#22c55e',
  red: '#ef4444', orange: '#f97316', teal: '#14b8a6', amber: '#f59e0b',
}


const PRIORITY_META: Record<string, { color: string }> = {
  low: { color: C.blue }, medium: { color: C.purple },
  high: { color: C.orange }, critical: { color: C.red },
}

const PLAYER_COLORS = [C.brand, C.purple, C.blue, C.green, C.teal, C.orange]

// ─── Utility ─────────────────────────────────────────────────────
function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 100) }

// ─── Chart Card ──────────────────────────────────────────────────
function Card({ title, sub, children, action, className = '' }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode; className?: string
}) {
  return (
    <div className={`dashCard ${className}`} style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.3px' }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontWeight: 600 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── KPI Tile ────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color, icon }: { label: string; value: number | string; sub?: string; color: string; icon: string }) {
  return (
    <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px 18px', position: 'relative', overflow: 'hidden', flex: '1 1 130px' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '18px 18px 0 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 24, lineHeight: 1 }}>{icon}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: color, background: color + '15', padding: '2px 7px', borderRadius: 999 }}>live</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 950, color: 'var(--text)', letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

// ─── Sparkline (pure SVG, no deps) ───────────────────────────────
function Sparkline({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  if (!data.length) return <div style={{ height }} />
  const max = Math.max(...data, 1)
  const w = 240, h = height
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w
    const y = h - (v / max) * (h - 4) - 2
    return `${x},${y}`
  })
  const area = `M ${pts[0]} ${pts.slice(1).map(p => `L ${p}`).join(' ')} L ${w},${h} L 0,${h} Z`
  const line = `M ${pts[0]} ${pts.slice(1).map(p => `L ${p}`).join(' ')}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace('#','')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={w} cy={h - (data[data.length-1] / max) * (h - 4) - 2} r="3.5" fill={color} />
    </svg>
  )
}

// ─── Horizontal bar row ───────────────────────────────────────────
function HBar({ label, value, max, color, right }: { label: string; value: number; max: number; color: string; right?: React.ReactNode }) {
  const w = max === 0 ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text)', flexShrink: 0, marginLeft: 8 }}>{value}</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 999, transition: 'width 0.8s ease' }} />
        </div>
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  )
}

// ─── Status ring (pure SVG donut) ─────────────────────────────────
function StatusRing({ data }: { data: Array<{ label: string; value: number; color: string }> }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No tasks yet</div>
  const r = 44, cx = 56, cy = 56, stroke = 10
  let offset = 0
  const circ = 2 * Math.PI * r
  const segs = data.filter(d => d.value > 0).map(d => {
    const dash = (d.value / total) * circ
    const seg = { ...d, dash, offset }
    offset += dash
    return seg
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={112} height={112} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {segs.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${s.dash} ${circ - s.dash}`}
            strokeDashoffset={circ / 4 - s.offset}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text)" fontSize="20" fontWeight="900">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--muted)" fontSize="9" fontWeight="700">TASKS</text>
      </svg>
      <div style={{ display: 'grid', gap: 7, flex: 1, minWidth: 120 }}>
        {segs.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text)' }}>{s.value}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', width: 30, textAlign: 'right' }}>{pct(s.value, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Mini bar chart (pure SVG) ────────────────────────────────────
function MiniBarChart({ data, keys, colors, height = 120 }: {
  data: Array<Record<string, any>>; keys: string[]; colors: string[]; height?: number
}) {
  if (!data.length) return null
  const allVals = data.flatMap(d => keys.map(k => Number(d[k] || 0)))
  const max = Math.max(...allVals, 1)
  const w = 240, h = height, gap = 4
  const groupW = (w - gap * (data.length - 1)) / data.length
  const barW = Math.max(4, (groupW - gap * (keys.length - 1)) / keys.length)
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} preserveAspectRatio="none" style={{ width: '100%', height: height + 20 }}>
      {data.map((d, i) => {
        const gx = i * (groupW + gap)
        return (
          <g key={i}>
            {keys.map((k, ki) => {
              const val = Number(d[k] || 0)
              const bh = (val / max) * h
              const bx = gx + ki * (barW + 2)
              const by = h - bh
              return (
                <g key={ki}>
                  <rect x={bx} y={by} width={barW} height={bh} fill={colors[ki]} rx={3} opacity={0.9} />
                </g>
              )
            })}
            <text x={gx + groupW / 2} y={h + 14} textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="600">
              {String(d.label || d.week || d.name || '').slice(0, 5)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────
export function DashboardHomePage() {
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDash,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const tasks       = data?.tasks
  const projects    = data?.projects    || []
  const leaderboard = data?.leaderboard || []
  const trend       = data?.trend       || []
  const velocity    = data?.velocity    || []

  // Derived
  const statusRingData = useMemo(() => {
    if (!tasks) return []
    return [
      { label: 'In Progress', value: tasks.in_progress,      color: C.purple },
      { label: 'Pending',     value: tasks.pending,          color: C.amber  },
      { label: 'Submitted',   value: tasks.submitted,        color: C.blue   },
      { label: 'Overdue',     value: tasks.overdue,          color: C.red    },
      { label: 'Done',        value: tasks.completed,        color: C.green  },
    ].filter(s => s.value > 0)
  }, [tasks])

  const priorityData = useMemo(() => {
    const p = data?.priority || {}
    return Object.entries(p)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => ({ label: k, value: v, color: PRIORITY_META[k]?.color || C.brand }))
  }, [data?.priority])

  const recentTrend = trend.slice(-10)
  const trendCompleted = recentTrend.map(d => d.completed)
  const trendCreated   = recentTrend.map(d => d.created)
  const trendOverdue   = recentTrend.map(d => d.overdue)

  const velData = velocity.slice(-8).map(v => ({
    ...v, label: v.week
  }))

  const Skel = ({ h = 80, r = 12 }: { h?: number; r?: number }) => (
    <div className="skeleton" style={{ height: h, borderRadius: r }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .dashGrid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .dashGrid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .dashGrid21 { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }
        .dashGrid12 { display: grid; grid-template-columns: 1fr 2fr; gap: 14px; }
        @media (max-width: 700px) {
          .dashGrid2, .dashGrid3, .dashGrid21, .dashGrid12 { grid-template-columns: 1fr !important; }
        }
        .dashKpiStrip { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
        .dashKpiStrip > * { flex: 0 0 auto; min-width: 140px; }
        @media (min-width: 701px) {
          .dashKpiStrip { flex-wrap: wrap; }
          .dashKpiStrip > * { flex: 1 1 140px; }
        }
      `}</style>

      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </div>
            <div className="pageHeaderCardSub">
              {tasks?.total || 0} tasks · {projects.length} projects · refreshes every 60s
            </div>
            <div className="pageHeaderCardMeta">
              {tasks?.overdue ? <span className="pageHeaderCardTag" style={{ color: C.red, background: C.red+'12', borderColor: C.red+'30' }}>⚠ {tasks.overdue} overdue</span> : null}
              {tasks?.due_today ? <span className="pageHeaderCardTag" style={{ color: C.orange, background: C.orange+'12', borderColor: C.orange+'30' }}>⏰ {tasks.due_today} due today</span> : null}
              {tasks?.completion_rate !== undefined && <span className="pageHeaderCardTag" style={{ color: C.green, background: C.green+'12', borderColor: C.green+'30' }}>✓ {tasks.completion_rate}% done</span>}
            </div>
          </div>
          {canCreate && (
            <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Task
            </button>
          )}
        </div>
      </div>

      <OnboardingBanner />

      {/* ── KPI Strip ── */}
      <div className="dashKpiStrip">
        {isLoading ? [1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 18, minWidth: 140, flex: '1 1 140px' }} />) : <>
          <KpiTile label="Total Tasks"     value={tasks?.total || 0}       sub={`${tasks?.due_today||0} due today`}   color={C.brand}  icon="📋" />
          <KpiTile label="In Progress"     value={tasks?.in_progress || 0} sub="active work"                          color={C.purple} icon="⚡" />
          <KpiTile label="Completed"       value={tasks?.completed || 0}   sub={`${tasks?.completion_rate||0}% rate`} color={C.green}  icon="✅" />
          <KpiTile label="Overdue"         value={tasks?.overdue || 0}     sub={`${tasks?.due_week||0} due this week`} color={C.red}   icon="⚠️" />
          <KpiTile label="Pending Review"  value={tasks?.submitted || 0}   sub="awaiting approval"                    color={C.blue}   icon="📨" />
          <KpiTile label="Projects"        value={projects.length}         sub={`${projects.filter(p=>p.progress===100).length} complete`} color={C.teal} icon="📁" />
        </>}
      </div>

      {/* ── Row 1: Status Ring + Task Trend ── */}
      <div className="dashGrid21">
        {/* Activity Sparklines */}
        <Card title="Task Activity" sub="Last 10 days — completed · created · overdue">
          {isLoading ? <Skel h={160} /> : recentTrend.length === 0 ? (
            <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No activity yet</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.green }}>✓ Completed</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: C.green }}>{trendCompleted.reduce((a,b)=>a+b,0)}</span>
                </div>
                <Sparkline data={trendCompleted} color={C.green} height={36} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.brand }}>+ Created</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: C.brand }}>{trendCreated.reduce((a,b)=>a+b,0)}</span>
                </div>
                <Sparkline data={trendCreated} color={C.brand} height={36} />
              </div>
              {trendOverdue.some(v=>v>0) && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.red }}>⚠ Became Overdue</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: C.red }}>{trendOverdue.reduce((a,b)=>a+b,0)}</span>
                  </div>
                  <Sparkline data={trendOverdue} color={C.red} height={28} />
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Status Ring */}
        <Card title="Status" sub="Current distribution">
          {isLoading ? <Skel h={120} /> : <StatusRing data={statusRingData} />}
        </Card>
      </div>

      {/* ── Row 2: Project Progress + Priority ── */}
      <div className="dashGrid12">
        {/* Priority breakdown */}
        <Card title="Priority" sub="Tasks by urgency">
          {isLoading ? <Skel h={120} /> : priorityData.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No tasks yet</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {priorityData.map(p => (
                <HBar key={p.label} label={p.label.charAt(0).toUpperCase()+p.label.slice(1)} value={p.value} max={priorityData[0]?.value || 1} color={p.color} />
              ))}
            </div>
          )}
        </Card>

        {/* Project Progress */}
        <Card title="Project Progress" sub="Completion per project" action={<Link to="/app/projects" style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 800, textDecoration: 'none' }}>View all →</Link>}>
          {isLoading ? <Skel h={200} /> : projects.length === 0 ? (
            <div style={{ height: 120, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No projects yet</div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {projects.slice(0, 6).map((p, i) => {
                const color = p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]
                return (
                  <div key={p.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{p.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{p.completed}/{p.total}</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: p.progress === 100 ? C.green : p.overdue > 0 ? C.red : 'var(--text)', minWidth: 36, textAlign: 'right' }}>{p.progress}%</span>
                      </div>
                    </div>
                    {/* Segmented progress bar */}
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--bg2)', display: 'flex', overflow: 'hidden', gap: 1 }}>
                      {p.completed > 0 && <div style={{ flex: p.completed, background: C.green, transition: 'flex 0.8s ease' }} />}
                      {p.in_progress > 0 && <div style={{ flex: p.in_progress, background: color, opacity: 0.7, transition: 'flex 0.8s ease' }} />}
                      {p.overdue > 0 && <div style={{ flex: p.overdue, background: C.red, transition: 'flex 0.8s ease' }} />}
                      {p.pending > 0 && <div style={{ flex: p.pending, background: 'var(--border)', transition: 'flex 0.8s ease' }} />}
                    </div>
                    {p.overdue > 0 && (
                      <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginTop: 3 }}>⚠ {p.overdue} overdue</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 3: Weekly Velocity ── */}
      <Card title="Weekly Velocity" sub="Tasks created vs. completed per week">
        {isLoading ? <Skel h={130} /> : velData.length < 2 ? (
          <div style={{ height: 80, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Need at least 2 weeks of data</div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
              {[{ label: 'Created', color: C.brand }, { label: 'Completed', color: C.green }].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{l.label}</span>
                </div>
              ))}
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                Avg: {Math.round(velData.reduce((s,v)=>s+v.completed,0)/velData.length)} completed/week
              </div>
            </div>
            <MiniBarChart
              data={velData}
              keys={['created', 'completed']}
              colors={[C.brand, C.green]}
              height={110}
            />
          </div>
        )}
      </Card>

      {/* ── Row 4: Employee Leaderboard ── */}
      <Card title="Team Performance" sub="Completion rate per team member"
        action={<Link to="/app/analytics" style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 800, textDecoration: 'none' }}>Analytics →</Link>}>
        {isLoading ? <Skel h={200} /> : leaderboard.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No team data yet</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {leaderboard.slice(0, 8).map((u, i) => {
              const color = PLAYER_COLORS[i % PLAYER_COLORS.length]
              const rate = u.completion_rate || 0
              return (
                <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'center' }}>
                  {/* Rank badge */}
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: color+'20', color, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900, flexShrink: 0 }}>
                    {i+1}
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{u.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{u.completed}/{u.total}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: 'var(--bg2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${rate}%`, background: rate >= 70 ? C.green : rate >= 40 ? color : C.red, borderRadius: 999, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: rate >= 70 ? C.green : rate >= 40 ? C.amber : C.red, minWidth: 36, textAlign: 'right' }}>
                    {rate}%
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Row 5: Assignments per person ── */}
      {leaderboard.length > 0 && (
        <div className="dashGrid2">
          <Card title="Active vs Overdue" sub="Per team member workload">
            {leaderboard.slice(0, 6).map((u, i) => {
              const color = PLAYER_COLORS[i % PLAYER_COLORS.length]
              const active = (u.in_progress || 0) + (u.total - u.completed - (u.overdue||0))
              void Math.max(...leaderboard.map(l => (l.in_progress||0) + l.overdue + l.completed))
              return (
                <div key={u.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)' }}>{u.name.split(' ')[0]}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{u.total} tasks</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'var(--bg2)', display: 'flex', overflow: 'hidden', gap: 1 }}>
                    {u.completed > 0 && <div style={{ flex: u.completed, background: C.green }} title="Done" />}
                    {active > 0 && <div style={{ flex: active, background: color, opacity: 0.8 }} title="Active" />}
                    {(u.overdue||0) > 0 && <div style={{ flex: u.overdue, background: C.red }} title="Overdue" />}
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              {[['Done', C.green], ['Active', C.purple], ['Overdue', C.red]].map(([l,c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{l}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Project task status stacked */}
          <Card title="Project Status" sub="Task distribution per project">
            {projects.slice(0, 5).map((p, i) => {
              const color = p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]
              return (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{p.total} tasks</span>
                  </div>
                  {p.total > 0 && (
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--bg2)', display: 'flex', overflow: 'hidden', gap: 1 }}>
                      {p.completed > 0 && <div style={{ flex: p.completed, background: C.green }} />}
                      {p.in_progress > 0 && <div style={{ flex: p.in_progress, background: color, opacity: 0.8 }} />}
                      {p.overdue > 0 && <div style={{ flex: p.overdue, background: C.red }} />}
                      {p.pending > 0 && <div style={{ flex: p.pending, background: 'var(--border)' }} />}
                    </div>
                  )}
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {/* ── Row 6: At-Risk Tasks ── */}
      <Card title="At-Risk Tasks" sub="Overdue and pending items needing attention">
        <AtRiskTasks />
      </Card>

      {canCreate && <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

// ─── At-Risk Tasks ────────────────────────────────────────────────
type RiskTask = { id: string; title: string; status: string; priority?: string | null; due_date?: string | null; assigned_to_name?: string | null; category_name?: string | null }

function AtRiskTasks() {
  const { data: overdue } = useQuery({
    queryKey: ['dash-overdue'],
    queryFn: () => apiFetch<{ tasks: RiskTask[] }>('/api/v1/tasks?limit=30&page=1&status=overdue').then(d => d.tasks || []),
    staleTime: 30_000,
  })
  const { data: pending } = useQuery({
    queryKey: ['dash-pending'],
    queryFn: () => apiFetch<{ tasks: RiskTask[] }>('/api/v1/tasks?limit=10&page=1&status=pending').then(d => d.tasks || []),
    staleTime: 30_000,
  })
  const all = [...(overdue || []), ...(pending || []).slice(0, 5)]
  if (!all.length) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
      <div style={{ fontWeight: 800, fontSize: 14 }}>All tasks on track!</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>No overdue or pending items.</div>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {all.slice(0, 15).map(t => {
        const isOverdue = t.status === 'overdue'
        const pColor = PRIORITY_META[t.priority || '']?.color || '#9ca3af'
        const due = t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
        return (
          <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '10px 14px', borderRadius: 12, background: isOverdue ? C.red+'06' : 'var(--bg2)', border: `1px solid ${isOverdue ? C.red+'25' : 'var(--border)'}`, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {t.category_name && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📁 {t.category_name}</span>}
                {t.assigned_to_name && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>👤 {t.assigned_to_name}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: isOverdue ? C.red+'15' : C.amber+'15', color: isOverdue ? C.red : C.amber }}>
                {isOverdue ? '⚠ Overdue' : '○ Pending'}
              </span>
              {t.priority && <span style={{ fontSize: 10, fontWeight: 800, color: pColor, textTransform: 'capitalize' }}>{t.priority}</span>}
              {due && <span style={{ fontSize: 10, color: isOverdue ? C.red : 'var(--muted)', fontWeight: 700 }}>{due}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
