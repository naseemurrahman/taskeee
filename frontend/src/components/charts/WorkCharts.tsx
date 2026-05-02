import { useRef, useEffect, useState, type ReactNode } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

const H    = 280
const AXIS = { fill: 'var(--chart-tick2,#94a3b8)', fontSize: 11, fontWeight: 600 as const }
const gridStroke = 'rgba(148,163,184,0.18)'

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

function Shell({ height = H, children }: { height?: number; children: (w: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const w   = useWidth(ref)
  return (
    <div ref={ref} style={{ width:'100%', height, minHeight:height, overflowX:'hidden', overflowY:'visible' }}>
      {w > 0 && children(w)}
    </div>
  )
}

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#101522', border:'1px solid rgba(255,255,255,.16)', borderRadius:12, padding:'12px 16px', boxShadow:'0 16px 40px rgba(0,0,0,0.4)', fontSize:12, color:'var(--text)' }}>
      {label && <div style={{ fontWeight:900, fontSize:11, marginBottom:8, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginTop:i>0?6:0 }}>
          <div style={{ width:10, height:10, borderRadius:3, background:p.color, flexShrink:0 }} />
          <span style={{ color:'var(--text2)', flex:1 }}>{p.name}</span>
          <span style={{ fontWeight:900 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

const VIVID = ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4','#a855f7','#ef4444','#14b8a6','#eab308','#3b82f6']

export function ProjectProgressChart(props: { rows: Array<{ name:string; done:number; remaining:number }>; fillHeight?: boolean }) {
  const data = (props.rows||[]).slice(0,8).map((r,i) => {
    const total = r.done + r.remaining
    return { ...r, total, pct: total>0 ? Math.round(r.done/total*100) : 0, color: VIVID[i%VIVID.length] }
  })
  if (!data.length) return (
    <div style={{ minHeight:200, display:'grid', placeItems:'center', color:'var(--muted)' }}>
      <div style={{ textAlign:'center' }}>📁<div style={{ marginTop:8, fontWeight:800 }}>No projects yet</div></div>
    </div>
  )
  return (
    <div style={{ display:'grid', gap:12, minHeight:200 }}>
      {data.map(p => (
        <div key={p.name}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
              <div style={{ width:9, height:9, borderRadius:2, background:p.color, flexShrink:0 }} />
              <span style={{ fontSize:13, fontWeight:800, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>{p.name}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <span style={{ fontSize:11, color:'var(--muted)', fontWeight:700 }}>{p.done}/{p.total}</span>
              <span style={{ fontSize:13, fontWeight:900, color:p.color, minWidth:38, textAlign:'right' }}>{p.pct}%</span>
            </div>
          </div>
          <div style={{ height:9, borderRadius:5, background:'rgba(148,163,184,0.16)', overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${p.pct}%`, background:p.color, borderRadius:5, transition:'width .4s ease' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AssignmentsChart(props: { rows: Array<{ name:string; active:number; overdue:number; done:number }>; fillHeight?: boolean }) {
  const data = (props.rows||[]).slice(0,8).map(r => ({
    name:   r.name.split(' ')[0].slice(0,12),
    Active: Number(r.active||0),
    Overdue: Number(r.overdue||0),
    Done:   Number(r.done||0),
  }))
  if (!data.length) return (
    <div style={{ minHeight:200, display:'grid', placeItems:'center', color:'var(--muted)' }}>
      <div style={{ textAlign:'center' }}>👥<div style={{ marginTop:8, fontWeight:800 }}>No assignments yet</div></div>
    </div>
  )
  const h = Math.max(H, data.length*44)
  return (
    <Shell height={h}>
      {(w) => (
        <BarChart width={w} height={h} data={data} layout="vertical" margin={{ top:8, right:16, left:4, bottom:8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={80} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill:'rgba(99,102,241,0.06)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:12, fontWeight:700, color:'var(--chart-tick2)', paddingTop:10 }} />
          <Bar dataKey="Done"    stackId="a" fill="#22c55e" radius={[0,6,6,0]} barSize={16} />
          <Bar dataKey="Active"  stackId="a" fill="#6366f1" radius={[0,6,6,0]} barSize={16} />
          <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[0,6,6,0]} barSize={16} />
        </BarChart>
      )}
    </Shell>
  )
}
