import { useRef, useLayoutEffect, useState, type ReactNode } from 'react'
import { IconBarChart } from '../ui/AppIcons'
import {
  AreaChart, Area,
  Bar, Cell,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie, PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const H = 300
const H_TALL = 360
const gridStroke = 'rgba(148,163,184,0.18)'
const AXIS = { fill: 'var(--chart-tick2,#94a3b8)', fontSize: 11, fontWeight: 650 as const }

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const measure = () => setW(ref.current?.offsetWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return w
}

function ChartShimmer({ height }: { height: number }) {
  return (
    <div style={{ width: '100%', height, minHeight: height, borderRadius: 12, overflow: 'hidden' }}>
      <div className="skeleton" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function Shell({ height = H, loading = false, children }: { height?: number; loading?: boolean; children: (w: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const w = useWidth(ref)
  if (loading || w === 0) return <div ref={ref} style={{ width: '100%' }}><ChartShimmer height={height} /></div>
  return <div ref={ref} style={{ width: '100%', height, minHeight: height, overflowX: 'hidden', overflowY: 'visible' }}>{children(w)}</div>
}

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const displayLabel = payload?.[0]?.payload?.employee || payload?.[0]?.payload?.fullName || label
  return (
    <div style={{ background: '#101522', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, padding: '12px 16px', boxShadow: '0 16px 40px rgba(0,0,0,0.4)', fontSize: 12, color: 'var(--text)', minWidth: 150 }}>
      {displayLabel && <div style={{ fontWeight: 900, fontSize: 11, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{displayLabel}</div>}
      {payload.map((p: any, i: number) => (
        <div key={`${p.dataKey}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: i > 0 ? 6 : 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color || p.fill, flexShrink: 0 }} />
          <span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 900 }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyChart({ title }: { title: string }) {
  return (
    <div style={{ minHeight: 200, display: 'grid', placeItems: 'center', color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
      <div>
        <div style={{ fontSize: 32, marginBottom: 8 }}><IconBarChart size={14} /></div>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Data will appear once tasks are added</div>
      </div>
    </div>
  )
}

function pct(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0
}

export function StatusBarChart(props: { byStatus: Record<string, number>; fillHeight?: boolean; loading?: boolean }) {
  const COLORS: Record<string, string> = {
    pending: '#f4ca57', in_progress: '#6366f1', submitted: '#8b5cf6',
    manager_approved: '#10b981', completed: '#22c55e', overdue: '#ef4444', cancelled: '#64748b',
  }
  const order = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue', 'cancelled']
  const raw = order
    .filter(k => (props.byStatus[k] ?? 0) > 0)
    .map(k => ({ name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: props.byStatus[k] || 0, key: k }))
  if (!raw.length) return <EmptyChart title="No tasks yet" />

  const total = raw.reduce((s, d) => s + d.value, 0)
  let running = 0
  const data = raw.map(d => {
    running += d.value
    return { ...d, share: pct(d.value, total), cumulative: pct(running, total) }
  })

  const h = props.fillHeight ? H_TALL : H
  return (
    <Shell height={h} loading={props.loading}>
      {(w) => (
        <ComposedChart width={w} height={h} data={data} barSize={Math.max(20, Math.min(46, (w / data.length) * 0.48))} margin={{ top: 14, right: 36, left: 4, bottom: 48 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={0}
            angle={data.length > 4 ? -18 : 0} textAnchor={data.length > 4 ? 'end' : 'middle'} height={data.length > 4 ? 62 : 42}
            label={{ value: 'Status', offset: -6, position: 'insideBottom', style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis yAxisId="count" tick={AXIS} axisLine={false} tickLine={false} width={42} allowDecimals={false}
            label={{ value: 'Tasks', angle: -90, position: 'insideLeft', offset: 12, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis yAxisId="rate" orientation="right" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`}
            label={{ value: 'Share', angle: 90, position: 'insideRight', offset: 6, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
          <Legend iconType="circle" iconSize={8} verticalAlign="bottom" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 12 }} />
          <Bar yAxisId="count" dataKey="value" name="Tasks" radius={[8, 8, 3, 3]}>
            {data.map(d => <Cell key={d.key} fill={COLORS[d.key] || '#6366f1'} />)}
          </Bar>
          <Line yAxisId="rate" type="monotone" dataKey="share" name="Status Share %" stroke="#38bdf8" strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line yAxisId="rate" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#f97316" strokeWidth={2.2} strokeDasharray="5 3" dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      )}
    </Shell>
  )
}

export function StatusDonutChart(props: { byStatus: Record<string, number>; loading?: boolean }) {
  const COLORS: Record<string,string> = {
    pending:'#f4ca57', in_progress:'#6366f1', submitted:'#8b5cf6',
    manager_approved:'#10b981', completed:'#22c55e', overdue:'#ef4444', manager_rejected:'#f97316', cancelled:'#64748b',
  }
  const data = Object.entries(props.byStatus || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, name: k.replace(/_/g, ' '), value: v, fill: COLORS[k] || '#94a3b8' }))
  if (!data.length) return <EmptyChart title="No status distribution yet" />
  const total = data.reduce((s, d) => s + d.value, 0)
  const h = 280
  return (
    <div style={{ position: 'relative' }}>
      <Shell height={h} loading={props.loading}>
        {(w) => (
          <PieChart width={w} height={h}>
            <Tooltip content={<GlassTooltip />} />
            <Pie data={data} dataKey="value" nameKey="name" cx={w / 2} cy={h / 2}
              innerRadius={Math.min(w, h) * 0.25} outerRadius={Math.min(w, h) * 0.38}
              paddingAngle={2} strokeWidth={0}>
              {data.map(d => <Cell key={d.key} fill={d.fill} />)}
            </Pie>
          </PieChart>
        )}
      </Shell>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 950 }}>{total}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tasks</div>
        </div>
      </div>
    </div>
  )
}

export function PriorityPieChart(props: { byPriority: Record<string, number>; fillHeight?: boolean; loading?: boolean }) {
  const COLORS: Record<string, string> = { low:'#38bdf8', medium:'#f4ca57', high:'#f97316', urgent:'#ef4444', critical:'#dc2626' }
  const weight: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4, critical: 5 }
  const order = ['critical', 'urgent', 'high', 'medium', 'low']
  const raw = order
    .map(k => ({ key: k, name: k.charAt(0).toUpperCase() + k.slice(1), value: Number(props.byPriority[k] || 0), fill: COLORS[k] || '#6366f1', weight: weight[k] || 1 }))
    .filter(d => d.value > 0)
  if (!raw.length) return <EmptyChart title="No priorities set" />

  const maxPressure = Math.max(1, ...raw.map(d => d.value * d.weight))
  const total = raw.reduce((s, d) => s + d.value, 0)
  const data = raw.map(d => ({ ...d, pressure: Math.round((d.value * d.weight / maxPressure) * 100), share: pct(d.value, total) }))
  const h = props.fillHeight ? 300 : 260

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(118px,.75fr)', gap: 12, alignItems: 'center' }}>
      <Shell height={h} loading={props.loading}>
        {(w) => (
          <RadarChart width={w} height={h} cx={w / 2} cy={h / 2} outerRadius={Math.min(w, h) * 0.36} data={data}>
            <PolarGrid stroke="rgba(148,163,184,0.18)" />
            <PolarAngleAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10, fontWeight: 800 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip content={<GlassTooltip />} />
            <Radar name="Priority Pressure" dataKey="pressure" stroke="#f97316" fill="#f97316" fillOpacity={0.22} strokeWidth={2.5} />
            <Radar name="Task Share %" dataKey="share" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.10} strokeWidth={2} />
          </RadarChart>
        )}
      </Shell>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.map(d => (
          <div key={d.key} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 850, color: d.fill }}>{d.name}</span>
              <span style={{ fontSize: 13, fontWeight: 950 }}>{d.value}</span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${d.pressure}%`, background: d.fill, borderRadius: 999 }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{d.pressure}% pressure</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DeadlinesTrendChart(props: { points: Array<{ day: string; due: number; completed?: number; overdue: number }>; fillHeight?: boolean; loading?: boolean }) {
  if (!props.points?.length) return <EmptyChart title="No trend data yet" />
  const h = props.fillHeight ? H_TALL : H
  return (
    <Shell height={h} loading={props.loading}>
      {(w) => (
        <AreaChart width={w} height={h} data={props.points} margin={{ top: 14, right: 16, left: 10, bottom: 32 }}>
          <defs>
            <linearGradient id="dueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.30} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} /></linearGradient>
            <linearGradient id="doneGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.30} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} /></linearGradient>
          </defs>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={20}
            label={{ value: 'Day', position: 'insideBottom', offset: -14, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={42} allowDecimals={false}
            label={{ value: 'Tasks', angle: -90, position: 'insideLeft', offset: 18, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <Tooltip content={<GlassTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 12 }} />
          <Area type="monotone" dataKey="due" name="Due / Created" stroke="#6366f1" strokeWidth={2.5} fill="url(#dueGradient)" dot={false} activeDot={{ r: 5 }} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2.5} fill="url(#doneGradient)" dot={false} activeDot={{ r: 5 }} />
          <Area type="monotone" dataKey="overdue" name="Overdue" stroke="#ef4444" strokeWidth={2.5} fill="#ef4444" fillOpacity={0.08} dot={false} activeDot={{ r: 5 }} />
        </AreaChart>
      )}
    </Shell>
  )
}

export function CompletedTrendChart(props: { points: Array<{ day: string; completed: number }>; loading?: boolean }) {
  if (!props.points?.length) return <EmptyChart title="No completion trend yet" />
  return (
    <Shell height={H} loading={props.loading}>
      {(w) => (
        <AreaChart width={w} height={H} data={props.points} margin={{ top: 14, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={20}
            label={{ value: 'Date', position: 'insideBottom', offset: -4, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={42} allowDecimals={false}
            label={{ value: 'Completed', angle: -90, position: 'insideLeft', offset: 12, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <Tooltip content={<GlassTooltip />} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={3} fill="#22c55e" fillOpacity={0.12} dot={false} activeDot={{ r: 5 }} />
        </AreaChart>
      )}
    </Shell>
  )
}

export function WorkloadBalanceChart(props: { workload: { averageOpenTasks: number; overloaded: any[]; underutilized: any[] }; userCount: number; fillHeight?: boolean; loading?: boolean }) {
  const overloaded = props.workload?.overloaded?.length ?? 0
  const underutilized = props.workload?.underutilized?.length ?? 0
  const balanced = Math.max(0, (props.userCount || 0) - overloaded - underutilized)
  const total = Math.max(1, balanced + overloaded + underutilized)
  const data = [
    { name: 'Balanced', people: balanced, pressure: pct(balanced, total), fill: '#22c55e' },
    { name: 'Overloaded', people: overloaded, pressure: pct(overloaded, total), fill: '#f97316' },
    { name: 'Underutilized', people: underutilized, pressure: pct(underutilized, total), fill: '#38bdf8' },
  ].filter(d => d.people > 0)
  if (!data.length) return <EmptyChart title="No team data yet" />

  const h = props.fillHeight ? 290 : 240
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Shell height={h} loading={props.loading}>
        {(w) => (
          <ComposedChart width={w} height={h} data={data} margin={{ top: 12, right: 34, left: 0, bottom: 36 }} barSize={Math.max(24, Math.min(54, w / 7))}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false}
              label={{ value: 'Capacity Segment', position: 'insideBottom', offset: -10, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
            />
            <YAxis yAxisId="people" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={36}
              label={{ value: 'People', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
            />
            <YAxis yAxisId="rate" orientation="right" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`}
              label={{ value: 'Share', angle: 90, position: 'insideRight', offset: 6, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
            />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
            <Legend iconType="circle" iconSize={8} verticalAlign="bottom" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 10 }} />
            <Bar yAxisId="people" dataKey="people" name="People" radius={[8, 8, 3, 3]}>
              {data.map(d => <Cell key={d.name} fill={d.fill} />)}
            </Bar>
            <Line yAxisId="rate" type="monotone" dataKey="pressure" name="Capacity Share %" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 5 }} />
          </ComposedChart>
        )}
      </Shell>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
        Avg {props.workload?.averageOpenTasks?.toFixed(1) ?? '0'} open tasks / person
      </div>
    </div>
  )
}

export function AssigneeScoreChart(props: { rows: Array<{ name: string; active: number; completed: number; performanceScore: number }>; fillHeight?: boolean; loading?: boolean }) {
  const source = (props.rows || [])
    .filter(r => (Number(r.active || 0) + Number(r.completed || 0)) > 0)
    .sort((a, b) => (b.performanceScore || 0) - (a.performanceScore || 0))
    .slice(0, 12)
  if (!source.length) return <EmptyChart title="No performance data yet" />

  const data = source.map((r, index) => {
    const active = Number(r.active || 0)
    const done = Number(r.completed || 0)
    const total = Math.max(0, active + done)
    const completionRate = total ? Math.round((done / total) * 100) : 0
    const score = Math.max(0, Math.min(100, Math.round(Number(r.performanceScore || completionRate))))
    return { label: String(index + 1), employee: r.name || 'Unassigned', score, completionRate, completedTasks: done, activeTasks: active }
  })

  const maxTasks = Math.max(1, ...data.map(d => Math.max(d.completedTasks, d.activeTasks)))
  const h = props.fillHeight ? H_TALL : H
  return (
    <Shell height={h} loading={props.loading}>
      {(w) => (
        <LineChart width={w} height={h} data={data} margin={{ top: 14, right: 44, left: 16, bottom: 44 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={0}
            label={{ value: 'Employee Rank', position: 'insideBottom', offset: -18, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis yAxisId="rate" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`}
            label={{ value: 'Performance Rate', angle: -90, position: 'insideLeft', offset: 8, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <YAxis yAxisId="tasks" orientation="right" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, maxTasks]}
            label={{ value: 'Task Volume', angle: 90, position: 'insideRight', offset: 6, style: { fill: 'var(--muted)', fontSize: 10, fontWeight: 700 } }}
          />
          <Tooltip content={<GlassTooltip />} cursor={{ stroke: 'rgba(148,163,184,0.22)', strokeWidth: 1 }} />
          <Legend iconType="circle" iconSize={8} verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 12 }} />
          <Line yAxisId="rate" type="monotone" dataKey="score" name="Score %" stroke="#2563eb" strokeWidth={2.6} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line yAxisId="rate" type="monotone" dataKey="completionRate" name="Completion %" stroke="#8b5cf6" strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line yAxisId="tasks" type="monotone" dataKey="completedTasks" name="Completed Tasks" stroke="#f59e0b" strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line yAxisId="tasks" type="monotone" dataKey="activeTasks" name="Active Tasks" stroke="#f97316" strokeWidth={2.2} strokeDasharray="5 3" dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      )}
    </Shell>
  )
}
