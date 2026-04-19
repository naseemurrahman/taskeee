import type { ReactNode } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'

const H = 260
const H_TALL = 300

// ── Custom Tooltip ──────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--tooltip-bg, rgba(15,17,22,0.95))',
      border: '1px solid var(--tooltip-border, rgba(255,255,255,0.12))',
      borderRadius: 12,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      fontSize: 12,
      minWidth: 120,
    }}>
      {label && <div style={{ fontWeight: 800, color: 'var(--chart-tick)', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i > 0 ? 4 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--chart-tick2)' }}>{p.name}:</span>
          <span style={{ fontWeight: 900, color: 'var(--chart-tick)' }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function Shell({ children, height = H }: { children: ReactNode; height?: number }) {
  return (
    <div className="chartScroll">
      <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={48}>
        {children as any}
      </ResponsiveContainer>
    </div>
  )
}

const axisStyle = { fill: 'var(--chart-tick2)', fontSize: 11, fontWeight: 600 }
const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '3 3', vertical: false }

// ── Status Bar Chart ────────────────────────────────────────────────────────
export function StatusBarChart(props: { byStatus: Record<string, number>; fillHeight?: boolean }) {
  const COLORS: Record<string, string> = {
    pending: '#f4ca57',
    in_progress: '#6366f1',
    submitted: '#8b5cf6',
    manager_approved: '#10b981',
    completed: '#22c55e',
    overdue: '#ef4444',
  }
  const order = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue']
  const data = order
    .filter(k => (props.byStatus[k] ?? 0) > 0)
    .map(k => ({
      name: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: props.byStatus[k] || 0,
      fill: COLORS[k] || '#6366f1',
    }))

  if (!data.length) return <EmptyChart />

  return (
    <Shell height={props.fillHeight ? H_TALL : H}>
      <BarChart data={data} barSize={32}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="value" name="Tasks" radius={[8, 8, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </Shell>
  )
}

// ── Priority Pie Chart ──────────────────────────────────────────────────────
export function PriorityPieChart(props: { byPriority: Record<string, number>; fillHeight?: boolean }) {
  const COLORS: Record<string, string> = {
    low: '#6366f1',
    medium: '#f4ca57',
    high: '#f97316',
    urgent: '#ef4444',
    critical: '#ef4444',
  }
  const data = Object.entries(props.byPriority)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v, fill: COLORS[k] || '#6366f1' }))

  if (!data.length) return <EmptyChart />
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
      <Shell height={220}>
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
            innerRadius={60} outerRadius={90} paddingAngle={3} strokeWidth={0}>
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Pie>
        </PieChart>
      </Shell>
      <div style={{ display: 'grid', gap: 8, minWidth: 100 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: d.fill, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{d.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round(d.value / total * 100)}% · {d.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Deadlines Trend — Area Chart ───────────────────────────────────────────
export function DeadlinesTrendChart(props: { points: Array<{ day: string; due: number; overdue: number }>; fillHeight?: boolean }) {
  if (!props.points?.length) return <EmptyChart />
  return (
    <Shell height={props.fillHeight ? H_TALL : H}>
      <AreaChart data={props.points}>
        <defs>
          <linearGradient id="gradDue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOverdue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="day" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 8 }} />
        <Area type="monotone" dataKey="due" name="Due" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradDue)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        <Area type="monotone" dataKey="overdue" name="Overdue" stroke="#ef4444" strokeWidth={2.5} fill="url(#gradOverdue)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
      </AreaChart>
    </Shell>
  )
}

// ── Workload Balance ─────────────────────────────────────────────────────────
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

  if (!data.length) return <EmptyChart />
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Shell height={200}>
        <BarChart data={data} barSize={44}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="value" name="Users" radius={[8, 8, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </Shell>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {data.map(d => (
          <div key={d.name} style={{ textAlign: 'center', padding: '8px', borderRadius: 10, background: `${d.fill}12`, border: `1px solid ${d.fill}25` }}>
            <div style={{ fontSize: 18, fontWeight: 950, color: d.fill }}>{d.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.name}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{total ? Math.round(d.value / total * 100) : 0}%</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
        Avg {props.workload?.averageOpenTasks?.toFixed(1) ?? '0'} open tasks / person
      </div>
    </div>
  )
}

// ── Assignee Score Chart ─────────────────────────────────────────────────────
export function AssigneeScoreChart(props: {
  rows: Array<{ name: string; active: number; completed: number; performanceScore: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || []).slice(0, 8).map(r => ({
    name: r.name.split(' ')[0],
    score: Math.round(r.performanceScore),
    active: r.active,
    done: r.completed,
  }))

  if (!data.length) return <EmptyChart />

  return (
    <Shell height={props.fillHeight ? H_TALL : H}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={72} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)' }} />
        <Bar dataKey="score" name="Score" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={12} />
        <Bar dataKey="done" name="Done" fill="#22c55e" radius={[0, 6, 6, 0]} barSize={12} />
        <Bar dataKey="active" name="Active" fill="#f4ca57" radius={[0, 6, 6, 0]} barSize={12} />
      </BarChart>
    </Shell>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyChart() {
  return (
    <div style={{ height: H, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📊</div>
        No data yet
      </div>
    </div>
  )
}
