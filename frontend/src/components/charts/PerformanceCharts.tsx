import { useRef, useEffect, useState, type ReactNode } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, AreaChart, Area, RadialBarChart, RadialBar,
} from 'recharts'

// ─── Design tokens ──────────────────────────────────────────────────────────
const H      = 300
const H_TALL = 360
const gridStroke = 'rgba(148,163,184,0.18)'
const AXIS   = { fill: 'var(--chart-tick2,#94a3b8)', fontSize: 11, fontWeight: 650 as const }

// ─── Container-width hook (ResizeObserver) ───────────────────────────────────
function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    setW(ref.current.offsetWidth || 0)
    const ro = new ResizeObserver(() => setW(ref.current?.offsetWidth || 0))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return w
}

// ─── Shell: measures its own pixel width, gives it to the chart ─────────────
// children is a render function: (width: number) => ReactNode
function Shell({ height = H, children }: { height?: number; children: (w: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const w   = useWidth(ref)
  return (
    <div ref={ref} style={{ width: '100%', height, minHeight: height, overflowX: 'hidden', overflowY: 'visible' }}>
      {w > 0 && children(w)}
    </div>
  )
}

// ─── Tooltip ────────────────────────────────────────────────────────────────
function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#101522', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, padding: '12px 16px', boxShadow: '0 16px 40px rgba(0,0,0,0.4)', fontSize: 12, color: 'var(--text)', minWidth: 140 }}>
      {label && <div style={{ fontWeight: 900, fontSize: 11, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: i > 0 ? 6 : 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text2)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 900 }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyChart({ title }: { title: string }) {
  return (
    <div style={{ minHeight: 200, display: 'grid', placeItems: 'center', color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
      <div>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Data will appear once tasks are added</div>
      </div>
    </div>
  )
}

// ─── Status Bar ──────────────────────────────────────────────────────────────
export function StatusBarChart(props: { byStatus: Record<string, number>; fillHeight?: boolean }) {
  const COLORS: Record<string, string> = {
    pending: '#f4ca57', in_progress: '#6366f1', submitted: '#8b5cf6',
    manager_approved: '#10b981', completed: '#22c55e', overdue: '#ef4444',
  }
  const order = ['pending','in_progress','submitted','manager_approved','completed','overdue']
  const data  = order.filter(k => (props.byStatus[k] ?? 0) > 0)
                     .map(k => ({ name: k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), value: props.byStatus[k]||0, key: k }))
  if (!data.length) return <EmptyChart title="No tasks yet" />
  const h = props.fillHeight ? H_TALL : H
  return (
    <Shell height={h}>
      {(w) => (
        <BarChart width={w} height={h} data={data} barSize={Math.max(20, Math.min(44, (w / data.length) * 0.5))} margin={{ top: 14, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={0}
            angle={data.length > 4 ? -20 : 0} textAnchor={data.length > 4 ? 'end' : 'middle'} height={data.length > 4 ? 60 : 36} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
          <Bar dataKey="value" name="Tasks" radius={[8,8,3,3]}>
            {data.map(d => <Cell key={d.key} fill={COLORS[d.key]||'#6366f1'} />)}
          </Bar>
        </BarChart>
      )}
    </Shell>
  )
}

// ─── Status Donut ─────────────────────────────────────────────────────────────
export function StatusDonutChart(props: { byStatus: Record<string, number> }) {
  const COLORS: Record<string,string> = {
    pending:'#f4ca57', in_progress:'#6366f1', submitted:'#8b5cf6',
    manager_approved:'#10b981', completed:'#22c55e', overdue:'#ef4444', manager_rejected:'#f97316',
  }
  const data = Object.entries(props.byStatus||{})
    .filter(([,v]) => v > 0)
    .map(([k,v]) => ({ key:k, name:k.replace(/_/g,' '), value:v, fill:COLORS[k]||'#94a3b8' }))
  if (!data.length) return <EmptyChart title="No status distribution yet" />
  const total = data.reduce((s,d) => s+d.value, 0)
  const h = 280
  return (
    <div style={{ position:'relative' }}>
      <Shell height={h}>
        {(w) => (
          <PieChart width={w} height={h}>
            <Tooltip content={<GlassTooltip />} />
            <Pie data={data} dataKey="value" nameKey="name"
              cx={w/2} cy={h/2}
              innerRadius={Math.min(w,h)*0.25} outerRadius={Math.min(w,h)*0.38}
              paddingAngle={2} strokeWidth={0}>
              {data.map(d => <Cell key={d.key} fill={d.fill} />)}
            </Pie>
          </PieChart>
        )}
      </Shell>
      <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', pointerEvents:'none' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:28, fontWeight:950 }}>{total}</div>
          <div style={{ fontSize:10, color:'var(--muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Tasks</div>
        </div>
      </div>
    </div>
  )
}

// ─── Priority Pie ─────────────────────────────────────────────────────────────
export function PriorityPieChart(props: { byPriority: Record<string,number>; fillHeight?: boolean }) {
  const COLORS: Record<string,string> = { low:'#38bdf8', medium:'#f4ca57', high:'#f97316', urgent:'#ef4444', critical:'#dc2626' }
  const data = Object.entries(props.byPriority)
    .filter(([,v]) => v>0)
    .map(([k,v]) => ({ name:k.charAt(0).toUpperCase()+k.slice(1), value:v, fill:COLORS[k]||'#6366f1' }))
    .sort((a,b) => b.value-a.value)
  if (!data.length) return <EmptyChart title="No priorities set" />
  const total = data.reduce((s,d) => s+d.value, 0)
  const h = 260
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr minmax(120px,0.8fr)', gap:12, alignItems:'center' }}>
      <div style={{ position:'relative', minWidth:0 }}>
        <Shell height={h}>
          {(w) => (
            <PieChart width={w} height={h}>
              <Tooltip content={<GlassTooltip />} />
              <Pie data={data} dataKey="value" nameKey="name"
                cx={w/2} cy={h/2}
                innerRadius={Math.min(w,h)*0.28} outerRadius={Math.min(w,h)*0.42}
                paddingAngle={3} strokeWidth={0} startAngle={90} endAngle={-270}>
                {data.map((d,i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
            </PieChart>
          )}
        </Shell>
        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', pointerEvents:'none' }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:26, fontWeight:950, letterSpacing:'-1px' }}>{total}</div>
            <div style={{ fontSize:10, color:'var(--muted)', marginTop:2, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Total</div>
          </div>
        </div>
      </div>
      <div style={{ display:'grid', gap:8 }}>
        {data.map(d => (
          <div key={d.name} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:9, height:9, borderRadius:2, background:d.fill, flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:6 }}>
                <span style={{ fontSize:12, fontWeight:800 }}>{d.name}</span>
                <span style={{ fontSize:13, fontWeight:900, color:d.fill }}>{d.value}</span>
              </div>
              <div style={{ height:3, borderRadius:2, background:'rgba(148,163,184,0.16)', marginTop:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${(d.value/total)*100}%`, background:d.fill, borderRadius:2 }} />
              </div>
              <div style={{ fontSize:10, color:'var(--muted)', marginTop:1, fontWeight:700 }}>{Math.round(d.value/total*100)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Deadlines Trend ──────────────────────────────────────────────────────────
export function DeadlinesTrendChart(props: {
  points: Array<{ day:string; due:number; completed?:number; overdue:number }>
  fillHeight?: boolean
}) {
  if (!props.points?.length) return <EmptyChart title="No trend data yet" />
  const h = props.fillHeight ? H_TALL : H
  return (
    <Shell height={h}>
      {(w) => (
        <AreaChart width={w} height={h} data={props.points} margin={{ top:14, right:16, left:0, bottom:8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={20} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<GlassTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:12, fontWeight:700, color:'var(--chart-tick2)', paddingTop:12 }} />
          <Area type="monotone" dataKey="due"       name="Created"   stroke="#6366f1" strokeWidth={3} fill="#6366f1" fillOpacity={0.12} dot={false} activeDot={{ r:5 }} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={3} fill="#22c55e" fillOpacity={0.12} dot={false} activeDot={{ r:5 }} />
          <Area type="monotone" dataKey="overdue"   name="Overdue"   stroke="#ef4444" strokeWidth={3} fill="#ef4444" fillOpacity={0.10} dot={false} activeDot={{ r:5 }} />
        </AreaChart>
      )}
    </Shell>
  )
}

// ─── Completed Trend ──────────────────────────────────────────────────────────
export function CompletedTrendChart(props: { points: Array<{ day:string; completed:number }> }) {
  if (!props.points?.length) return <EmptyChart title="No completion trend yet" />
  return (
    <Shell height={H}>
      {(w) => (
        <AreaChart width={w} height={H} data={props.points} margin={{ top:14, right:16, left:0, bottom:8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={20} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip content={<GlassTooltip />} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={3} fill="#22c55e" fillOpacity={0.12} dot={false} activeDot={{ r:5 }} />
        </AreaChart>
      )}
    </Shell>
  )
}

// ─── Workload Balance ─────────────────────────────────────────────────────────
export function WorkloadBalanceChart(props: {
  workload: { averageOpenTasks:number; overloaded:any[]; underutilized:any[] }
  userCount: number; fillHeight?: boolean
}) {
  const ol  = props.workload?.overloaded?.length   ?? 0
  const ul  = props.workload?.underutilized?.length ?? 0
  const bal = Math.max(0, (props.userCount||0) - ol - ul)
  const data = [
    { name:'Balanced',    value:bal, fill:'#22c55e' },
    { name:'Overloaded',  value:ol,  fill:'#f97316' },
    { name:'Underutilized', value:ul, fill:'#38bdf8' },
  ].filter(d => d.value > 0)
  if (!data.length) return <EmptyChart title="No team data yet" />
  const total       = data.reduce((s,d) => s+d.value, 0)
  const balancedPct = total > 0 ? Math.round((bal/total)*100) : 0
  const h = 200
  return (
    <div style={{ display:'grid', gap:12 }}>
      <div style={{ position:'relative' }}>
        <Shell height={h}>
          {(w) => (
            <RadialBarChart width={w} height={h} cx={w/2} cy={h/2}
              innerRadius={Math.min(w,h)*0.3} outerRadius={Math.min(w,h)*0.46}
              barSize={14} startAngle={90} endAngle={-270}
              data={[{ name:'Balanced', value:balancedPct, fill:'#22c55e' }]}>
              <RadialBar dataKey="value" cornerRadius={8} background={{ fill:'rgba(148,163,184,0.16)' }} />
            </RadialBarChart>
          )}
        </Shell>
        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', pointerEvents:'none' }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:950, color:'#22c55e' }}>{balancedPct}%</div>
            <div style={{ fontSize:10, color:'var(--muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Balanced</div>
          </div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${data.length},1fr)`, gap:8 }}>
        {data.map(d => (
          <div key={d.name} style={{ textAlign:'center', padding:'8px 4px', borderRadius:10, background:`${d.fill}14`, border:`1px solid ${d.fill}28` }}>
            <div style={{ fontSize:18, fontWeight:950, color:d.fill }}>{d.value}</div>
            <div style={{ fontSize:10, color:'var(--text2)', marginTop:2, fontWeight:700 }}>{d.name}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign:'center', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
        Avg {props.workload?.averageOpenTasks?.toFixed(1)??'0'} open tasks / person
      </div>
    </div>
  )
}

// ─── Assignee Score ───────────────────────────────────────────────────────────
export function AssigneeScoreChart(props: {
  rows: Array<{ name:string; active:number; completed:number; performanceScore:number }>
  fillHeight?: boolean
}) {
  const data = (props.rows||[])
    .slice(0,8)
    .sort((a,b) => (b.performanceScore||0)-(a.performanceScore||0))
    .map(r => ({
      name:  r.name.split(' ').slice(0,2).join(' ').slice(0,16),
      score: Math.round(r.performanceScore),
      active: r.active,
      done:   r.completed,
    }))
  if (!data.length) return <EmptyChart title="No performance data yet" />
  const maxCount = Math.max(1, ...data.map(d => Math.max(d.active, d.done)))
  const h = Math.max(H, data.length*52)
  return (
    <Shell height={h}>
      {(w) => (
        <BarChart width={w} height={h} data={data} layout="vertical"
          barCategoryGap="34%" margin={{ top:8, right:72, left:4, bottom:0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" horizontal={false} />
          <XAxis xAxisId="score" type="number" domain={[0,100]} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
          <XAxis xAxisId="count" type="number" domain={[0,maxCount]} hide />
          <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={88} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill:'rgba(99,102,241,0.05)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:12, fontWeight:700, color:'var(--chart-tick2)', paddingTop:8 }} />
          <Bar dataKey="score"  xAxisId="score" name="Score %" fill="#8b5cf6" radius={[0,8,8,0]} barSize={12}
            label={{ position:'right', fill:'var(--chart-tick2)', fontSize:10, formatter:(v:any)=>`${Number(v||0)}%` }} />
          <Bar dataKey="done"   xAxisId="count" name="Done"    fill="#22c55e" radius={[0,8,8,0]} barSize={8} />
          <Bar dataKey="active" xAxisId="count" name="Active"  fill="#f4ca57" radius={[0,8,8,0]} barSize={8} />
        </BarChart>
      )}
    </Shell>
  )
}
