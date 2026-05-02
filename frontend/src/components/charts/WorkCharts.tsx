import type { ReactNode } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'

const H = 280
const AXIS = { fill: 'var(--chart-tick2)', fontSize: 11, fontWeight: 600 }

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--tooltip-bg)',
      border: '1px solid var(--tooltip-border)',
      borderRadius: 12, padding: '12px 16px',
      boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
      fontSize: 12, color: 'var(--tooltip-text, var(--text))',
    }}>
      {label && (
        <div style={{ fontWeight: 900, fontSize: 11, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: i > 0 ? 6 : 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 900 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function Shell({ children, height = H }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ width: '100%', minWidth: 0, height: height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={48}>
        {children as any}
      </ResponsiveContainer>
    </div>
  )
}

const VIVID = ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4','#a855f7','#ef4444','#14b8a6','#eab308','#3b82f6']

// ── Project Progress — elegant progress bars (better than bar chart for this) ──
export function ProjectProgressChart(props: {
  rows: Array<{ name: string; done: number; remaining: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || []).slice(0, 8).map((r, i) => {
    const total = r.done + r.remaining
    return {
      ...r,
      total,
      pct: total > 0 ? Math.round(r.done / total * 100) : 0,
      color: VIVID[i % VIVID.length],
    }
  })

  if (!data.length) {
    return (
      <div className="emptyStateV3" style={{ padding: '40px 20px' }}>
        <div className="emptyStateV3Icon">📁</div>
        <div className="emptyStateV3Title">No projects yet</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {data.map(p => (
        <div key={p.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 3,
                background: p.color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 13, fontWeight: 800,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180,
              }}>{p.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{p.done}/{p.total}</span>
              <span style={{
                fontSize: 13, fontWeight: 900, color: p.color,
                minWidth: 42, textAlign: 'right',
              }}>{p.pct}%</span>
            </div>
          </div>
          <div style={{
            height: 10, borderRadius: 5,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              height: '100%', width: `${p.pct}%`,
              background: `linear-gradient(90deg, ${p.color}, ${p.color}dd)`,
              borderRadius: 5,
              transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
                animation: 'shimmer 2.4s ease infinite',
              }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Assignments Chart — stacked horizontal bars ───────────────────
export function AssignmentsChart(props: {
  rows: Array<{ name: string; active: number; overdue: number; done: number }>
  fillHeight?: boolean
}) {
  const data = (props.rows || []).slice(0, 8).map(r => ({
    name: r.name.split(' ')[0].slice(0, 12),
    Active: r.active,
    Overdue: r.overdue,
    Done: r.done,
  }))

  if (!data.length) {
    return (
      <div className="emptyStateV3" style={{ padding: '40px 20px' }}>
        <div className="emptyStateV3Icon">👥</div>
        <div className="emptyStateV3Title">No assignments yet</div>
      </div>
    )
  }

  return (
    <Shell height={Math.max(H, data.length * 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 20, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradDoneV3" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id="gradActiveV3" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id="gradOverdueV3" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.88} />
            <stop offset="100%" stopColor="#dc2626" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={80} />
        <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--chart-tick2)', paddingTop: 10 }} />
        <Bar dataKey="Done" stackId="a" fill="url(#gradDoneV3)" radius={[0, 6, 6, 0]} barSize={14} />
        <Bar dataKey="Active" stackId="a" fill="url(#gradActiveV3)" radius={[0, 6, 6, 0]} barSize={14} />
        <Bar dataKey="Overdue" stackId="a" fill="url(#gradOverdueV3)" radius={[0, 6, 6, 0]} barSize={14} />
      </BarChart>
    </Shell>
  )
}
