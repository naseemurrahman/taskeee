import type { ReactNode } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'

const H = 280
const AXIS = { fill: 'var(--chart-tick2)', fontSize: 11, fontWeight: 600 }

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--tooltip-bg, var(--p8-menu-bg-dark, #101522))', border: '1px solid var(--tooltip-border, rgba(255,255,255,.16))', borderRadius: 12, padding: '12px 16px', boxShadow: '0 16px 40px rgba(0,0,0,0.35)', fontSize: 12, color: 'var(--tooltip-text, var(--text))' }}>
      {label && <div style={{ fontWeight: 900, fontSize: 11, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>}
      {payload.map((p: any, i: number) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: i > 0 ? 6 : 0 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} /><span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span><span style={{ fontWeight: 900 }}>{p.value}</span></div>)}
    </div>
  )
}

function Shell({ children, height = H }: { children: ReactNode; height?: number }) {
  return <div style={{ width: '100%', minWidth: 0, height, minHeight: height, overflowX: 'auto', overflowY: 'hidden' }}>{children}</div>
}

const VIVID = ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4','#a855f7','#ef4444','#14b8a6','#eab308','#3b82f6']

export function ProjectProgressChart(props: { rows: Array<{ name: string; done: number; remaining: number }>; fillHeight?: boolean }) {
  const data = (props.rows || []).slice(0, 8).map((r, i) => {
    const total = r.done + r.remaining
    return { ...r, total, pct: total > 0 ? Math.round(r.done / total * 100) : 0, color: VIVID[i % VIVID.length] }
  })
  if (!data.length) return <div className="emptyStateV3" style={{ padding: '40px 20px' }}><div className="emptyStateV3Icon">📁</div><div className="emptyStateV3Title">No projects yet</div></div>
  return (
    <div style={{ display: 'grid', gap: 14, minHeight: 240 }}>
      {data.map(p => <div key={p.name}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} /><span style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{p.name}</span></div><div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}><span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{p.done}/{p.total}</span><span style={{ fontSize: 13, fontWeight: 900, color: p.color, minWidth: 42, textAlign: 'right' }}>{p.pct}%</span></div></div><div style={{ height: 10, borderRadius: 5, background: 'rgba(148,163,184,0.16)', overflow: 'hidden', position: 'relative' }}><div style={{ height: '100%', width: `${p.pct}%`, background: p.color, borderRadius: 5, transition: 'width .4s ease' }} /></div></div>)}
    </div>
  )
}

export function AssignmentsChart(props: { rows: Array<{ name: string; active: number; overdue: number; done: number }>; fillHeight?: boolean }) {
  const data = (props.rows || []).slice(0, 8).map(r => ({ name: r.name.split(' ')[0].slice(0, 12), Active: Number(r.active || 0), Overdue: Number(r.overdue || 0), Done: Number(r.done || 0) }))
  if (!data.length) return <div className="emptyStateV3" style={{ padding: '40px 20px' }}><div className="emptyStateV3Icon">👥</div><div className="emptyStateV3Title">No assignments yet</div></div>
  const height = Math.max(H, data.length * 44)
  const width = 680
  return (
    <Shell height={height}>
      <BarChart width={width} height={height} data={data} layout="vertical" margin={{ top: 8, right: 20, left: 4, bottom: 8 }}>
        <CartesianGrid stroke="rgba(148,163,184,.18)" strokeDasharray="4 4" horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={80} />
        <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 10 }} />
        <Bar dataKey="Done" stackId="a" fill="#22c55e" radius={[0, 6, 6, 0]} barSize={16} />
        <Bar dataKey="Active" stackId="a" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={16} />
        <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[0, 6, 6, 0]} barSize={16} />
      </BarChart>
    </Shell>
  )
}
