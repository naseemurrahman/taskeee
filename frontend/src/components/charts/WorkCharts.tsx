import type { ReactNode } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend
} from 'recharts'

const H = 260
const axisStyle = { fill: 'var(--chart-tick2)', fontSize: 11, fontWeight: 600 }
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--tooltip-bg, rgba(15,17,22,0.95))',
      border: '1px solid var(--tooltip-border, rgba(255,255,255,0.12))',
      borderRadius: 12, padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', fontSize: 12,
    }}>
      {label && <div style={{ fontWeight: 800, color: 'var(--chart-tick)', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i > 0 ? 4 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--chart-tick2)' }}>{p.name}:</span>
          <span style={{ fontWeight: 900, color: 'var(--chart-tick)' }}>{p.value}</span>
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

const VIVID = ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4','#a855f7','#ef4444','#14b8a6','#eab308','#3b82f6']

// ── Project Progress — Stacked horizontal bars ──────────────────────────────
export function ProjectProgressChart(props: {
  rows: Array<{ name: string; done: number; remaining: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || []).slice(0, 8).map(r => ({
    ...r,
    total: r.done + r.remaining,
    pct: r.done + r.remaining > 0 ? Math.round(r.done / (r.done + r.remaining) * 100) : 0,
  }))

  if (!data.length) {
    return (
      <div style={{ height: H, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
        <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📁</div>No projects yet</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((p, i) => (
        <div key={p.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: VIVID[i % VIVID.length], flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{p.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.done}/{p.total}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: VIVID[i % VIVID.length] }}>{p.pct}%</span>
            </div>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${p.pct}%`,
              background: `linear-gradient(90deg, ${VIVID[i % VIVID.length]}, ${VIVID[i % VIVID.length]}bb)`,
              borderRadius: 4,
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Assignments Chart — Grouped horizontal bar ───────────────────────────────
export function AssignmentsChart(props: {
  rows: Array<{ name: string; active: number; overdue: number; done: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || []).slice(0, 8).map(r => ({
    name: r.name.split(' ')[0],
    Active: r.active,
    Overdue: r.overdue,
    Done: r.done,
  }))

  if (!data.length) return (
    <div style={{ height: H, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>👥</div>No assignments yet</div>
    </div>
  )

  return (
    <Shell height={Math.max(H, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={68} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 8 }} />
        <Bar dataKey="Done" fill="#22c55e" radius={[0, 6, 6, 0]} barSize={10} stackId="a" />
        <Bar dataKey="Active" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={10} stackId="a" />
        <Bar dataKey="Overdue" fill="#ef4444" radius={[0, 6, 6, 0]} barSize={10} stackId="a" />
      </BarChart>
    </Shell>
  )
}
