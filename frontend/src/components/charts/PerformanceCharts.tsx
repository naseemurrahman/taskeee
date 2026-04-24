import type { ReactNode } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, AreaChart, Area, RadialBarChart, RadialBar,
} from 'recharts'

const H = 280
const H_TALL = 320

// ── Modern Glass Tooltip ─────────────────────────────────────────
function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--tooltip-bg)',
      border: '1px solid var(--tooltip-border)',
      borderRadius: 12,
      padding: '12px 16px',
      boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
      fontSize: 12,
      color: 'var(--tooltip-text, var(--text))',
      minWidth: 140,
    }}>
      {label && (
        <div style={{
          fontWeight: 900, fontSize: 11, marginBottom: 8,
          color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{label}</div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: i > 0 ? 6 : 0,
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: 3,
            background: p.color, flexShrink: 0,
          }} />
          <span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 900 }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function Shell({ children, height = H }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={48}>
        {children as any}
      </ResponsiveContainer>
    </div>
  )
}

const AXIS = { fill: 'var(--chart-tick2)', fontSize: 11, fontWeight: 600 }
const GRID = { stroke: 'var(--chart-grid)', strokeDasharray: '4 4', vertical: false }

// ── Status Bar — dual-tone bars (like OrcaHR work hours) ────────────
export function StatusBarChart(props: { byStatus: Record<string, number>; fillHeight?: boolean }) {
  const COLORS: Record<string, [string, string]> = {
    pending:          ['#f4ca57', '#fbd576'],
    in_progress:      ['#6366f1', '#818cf8'],
    submitted:        ['#8b5cf6', '#a78bfa'],
    manager_approved: ['#10b981', '#34d399'],
    completed:        ['#22c55e', '#4ade80'],
    overdue:          ['#ef4444', '#f87171'],
  }
  const order = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue']
  const data = order
    .filter(k => (props.byStatus[k] ?? 0) > 0)
    .map(k => ({
      name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: props.byStatus[k] || 0,
      key: k,
    }))

  if (!data.length) return <EmptyChart icon="📊" title="No tasks yet" />

  return (
    <Shell height={props.fillHeight ? H_TALL : H}>
      <BarChart data={data} barSize={44} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {data.map(d => {
            const [c1, c2] = COLORS[d.key] || ['#6366f1', '#818cf8']
            return (
              <linearGradient key={d.key} id={`grad-${d.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c2} stopOpacity={0.95} />
                <stop offset="100%" stopColor={c1} stopOpacity={0.85} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)', radius: 10 }} />
        <Bar dataKey="value" name="Tasks" radius={[10, 10, 4, 4]}>
          {data.map((d) => <Cell key={d.key} fill={`url(#grad-${d.key})`} />)}
        </Bar>
      </BarChart>
    </Shell>
  )
}

// ── Priority Donut with side legend ──────────────────────────────
export function PriorityPieChart(props: { byPriority: Record<string, number>; fillHeight?: boolean }) {
  const COLORS: Record<string, string> = {
    low: '#38bdf8', medium: '#f4ca57', high: '#f97316', urgent: '#ef4444', critical: '#dc2626',
  }
  const data = Object.entries(props.byPriority)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: k.charAt(0).toUpperCase() + k.slice(1),
      value: v,
      fill: COLORS[k] || '#6366f1',
    }))
    .sort((a, b) => b.value - a.value)

  if (!data.length) return <EmptyChart icon="🎯" title="No priorities set" />
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <Shell height={220}>
          <PieChart>
            <Tooltip content={<GlassTooltip />} />
            <Pie
              data={data} dataKey="value" nameKey="name"
              cx="50%" cy="50%" innerRadius={62} outerRadius={92}
              paddingAngle={3} strokeWidth={0} startAngle={90} endAngle={-270}
            >
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
        </Shell>
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 950, letterSpacing: '-1px' }}>{total}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: d.fill, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{d.name}</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: d.fill }}>{d.value}</span>
              </div>
              <div style={{
                height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.06)', marginTop: 4, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${(d.value / total) * 100}%`,
                  background: d.fill, borderRadius: 2,
                  transition: 'width 0.6s ease',
                }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontWeight: 700 }}>
                {Math.round(d.value / total * 100)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Deadlines Trend — Area chart with dual gradient (like Werker) ─
export function DeadlinesTrendChart(props: {
  points: Array<{ day: string; due: number; overdue: number }>
  fillHeight?: boolean
}) {
  if (!props.points?.length) return <EmptyChart icon="📅" title="No upcoming deadlines" />
  return (
    <Shell height={props.fillHeight ? H_TALL : H}>
      <AreaChart data={props.points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradDueV3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.38} />
            <stop offset="60%" stopColor="#6366f1" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOverdueV3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
            <stop offset="60%" stopColor="#22d3ee" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<GlassTooltip />} />
        <Legend
          iconType="circle" iconSize={8}
          wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 12 }}
        />
        <Area
          type="monotone" dataKey="due" name="Due"
          stroke="#6366f1" strokeWidth={3}
          fill="url(#gradDueV3)"
          dot={false}
          activeDot={{ r: 6, strokeWidth: 3, stroke: 'var(--bg)', fill: '#6366f1' }}
        />
        <Area
          type="monotone" dataKey="overdue" name="Overdue"
          stroke="#22d3ee" strokeWidth={3}
          fill="url(#gradOverdueV3)"
          dot={false}
          activeDot={{ r: 6, strokeWidth: 3, stroke: 'var(--bg)', fill: '#22d3ee' }}
        />
      </AreaChart>
    </Shell>
  )
}

// ── Workload Balance — Donut with % center (like Workup salary gauge) ─
export function WorkloadBalanceChart(props: {
  workload: { averageOpenTasks: number; overloaded: any[]; underutilized: any[] }
  userCount: number
  fillHeight?: boolean
}) {
  const ol = props.workload?.overloaded?.length ?? 0
  const ul = props.workload?.underutilized?.length ?? 0
  const bal = Math.max(0, (props.userCount || 0) - ol - ul)
  const data = [
    { name: 'Balanced', value: bal, fill: '#22c55e' },
    { name: 'Overloaded', value: ol, fill: '#f97316' },
    { name: 'Underutilized', value: ul, fill: '#38bdf8' },
  ].filter(d => d.value > 0)

  if (!data.length) return <EmptyChart icon="👥" title="No team data yet" />

  const total = data.reduce((s, d) => s + d.value, 0)
  const balancedPct = total > 0 ? Math.round((bal / total) * 100) : 0

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ position: 'relative' }}>
        <Shell height={200}>
          <RadialBarChart
            cx="50%" cy="50%"
            innerRadius="65%" outerRadius="100%"
            barSize={14} startAngle={90} endAngle={-270}
            data={[
              { name: 'Balanced', value: balancedPct, fill: '#22c55e' },
            ]}
          >
            <RadialBar dataKey="value" cornerRadius={8} background={{ fill: 'rgba(255,255,255,0.05)' }} />
          </RadialBarChart>
        </Shell>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: '-0.8px', color: '#22c55e' }}>{balancedPct}%</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Balanced</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {data.map(d => (
          <div key={d.name} style={{
            textAlign: 'center', padding: '10px 4px', borderRadius: 12,
            background: `${d.fill}14`, border: `1px solid ${d.fill}28`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 950, color: d.fill, letterSpacing: '-0.5px' }}>{d.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, fontWeight: 700 }}>{d.name}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
        Avg {props.workload?.averageOpenTasks?.toFixed(1) ?? '0'} open tasks / person
      </div>
    </div>
  )
}

// ── Assignee Score Chart (horizontal ranking bars) ──────────────
export function AssigneeScoreChart(props: {
  rows: Array<{ name: string; active: number; completed: number; performanceScore: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || [])
    .slice(0, 8)
    .sort((a, b) => (b.performanceScore || 0) - (a.performanceScore || 0))
    .map(r => ({
    name: r.name.split(' ').slice(0, 2).join(' ').slice(0, 16),
    score: Math.round(r.performanceScore),
    active: r.active,
    done: r.completed,
  }))
  const maxCount = Math.max(1, ...data.map(d => Math.max(d.active, d.done)))

  if (!data.length) return <EmptyChart icon="🏆" title="No performance data yet" />

  return (
    <Shell height={Math.max(H, data.length * 48)}>
      <BarChart data={data} layout="vertical" barCategoryGap="34%" margin={{ top: 8, right: 18, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradScore" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id="gradDone" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id="gradActive" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f4ca57" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" horizontal={false} />
        <XAxis
          xAxisId="score"
          type="number"
          domain={[0, 100]}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <XAxis xAxisId="count" type="number" domain={[0, maxCount]} hide />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={90} />
        <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.05)' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 8 }} />
        <Bar dataKey="score" xAxisId="score" name="Score %" fill="url(#gradScore)" radius={[0, 8, 8, 0]} barSize={12}
          label={{ position: 'right', fill: 'var(--chart-tick2)', fontSize: 10, formatter: (v: any) => `${Number(v || 0)}%` }} />
        <Bar dataKey="done" xAxisId="count" name="Done" fill="url(#gradDone)" radius={[0, 8, 8, 0]} barSize={8} />
        <Bar dataKey="active" xAxisId="count" name="Active" fill="url(#gradActive)" radius={[0, 8, 8, 0]} barSize={8} />
      </BarChart>
    </Shell>
  )
}

// ── Empty state ─────────────────────────────────────────────────
function EmptyChart({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="emptyStateV3" style={{ padding: '40px 20px' }}>
      <div className="emptyStateV3Icon">{icon}</div>
      <div className="emptyStateV3Title">{title}</div>
      <div className="emptyStateV3Body">Data will appear once tasks are added</div>
    </div>
  )
}
