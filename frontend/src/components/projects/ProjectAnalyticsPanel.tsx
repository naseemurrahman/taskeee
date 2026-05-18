import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, AlertTriangle, CheckCircle2, Clock3, ListTodo, TrendingUp } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { KpiStrip } from '../ui/KpiCard'

type ProjectSummary = {
  project_id: string
  project_name: string
  project_status?: string | null
  total_tasks: number
  completed_tasks: number
  open_tasks: number
  overdue_tasks: number
  high_priority_tasks: number
  completion_rate: number | null
  earliest_due_date?: string | null
  latest_due_date?: string | null
}

type ProjectTrendPoint = {
  day: string
  project_id: string
  project_name: string
  created: number
  completed: number
  overdue: number
}

function n(value: unknown) {
  return Number(value || 0)
}

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0
}

async function fetchProjectSummary() {
  const data = await apiFetch<{ projects: ProjectSummary[] }>('/api/v1/analytics/project-summary?days=90')
  return data.projects || []
}

async function fetchProjectTrend() {
  const data = await apiFetch<{ points: ProjectTrendPoint[] }>('/api/v1/analytics/project-trend?days=30')
  return data.points || []
}

function Empty({ title, detail = 'No project analytics for the selected period.' }: { title: string; detail?: string }) {
  return (
    <div style={{ minHeight: 120, display: 'grid', placeItems: 'center', color: 'var(--muted)', textAlign: 'center', padding: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 900 }}>{title}</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>{detail}</div>
      </div>
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0, overflow: 'hidden' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 950, color: 'var(--text)' }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontWeight: 700 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

function ProgressRows({ projects }: { projects: ProjectSummary[] }) {
  const rows = projects.filter((p) => n(p.total_tasks) > 0).slice(0, 8)
  if (!rows.length) return <Empty title="No project progress yet" />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((p, index) => {
        const total = n(p.total_tasks)
        const completed = n(p.completed_tasks)
        const open = n(p.open_tasks)
        const overdue = n(p.overdue_tasks)
        const rate = n(p.completion_rate) || pct(completed, total)
        const color = overdue > 0 ? '#ef4444' : rate >= 80 ? '#22c55e' : ['#e2ab41', '#8b5cf6', '#38bdf8', '#f97316'][index % 4]
        return (
          <div key={p.project_id || p.project_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.project_name}</span>
              <span style={{ fontSize: 12, fontWeight: 950, color }}>{rate}%</span>
            </div>
            <div style={{ display: 'flex', height: 10, background: 'rgba(148,163,184,.14)', borderRadius: 999, overflow: 'hidden' }}>
              <i style={{ width: `${pct(completed, total)}%`, background: '#22c55e' }} />
              <i style={{ width: `${pct(open, total)}%`, background: color, opacity: .75 }} />
              <i style={{ width: `${pct(overdue, total)}%`, background: '#ef4444' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, fontWeight: 800, color: 'var(--muted)' }}>
              <span>{completed} done</span><span>{open} open</span>{overdue > 0 ? <span style={{ color: '#ef4444' }}>{overdue} overdue</span> : null}{p.high_priority_tasks > 0 ? <span style={{ color: '#f97316' }}>{p.high_priority_tasks} high priority</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PortfolioRisk({ projects }: { projects: ProjectSummary[] }) {
  const rows = projects
    .filter((p) => n(p.open_tasks) > 0 || n(p.overdue_tasks) > 0 || n(p.high_priority_tasks) > 0)
    .map((p) => ({ ...p, risk: n(p.overdue_tasks) * 5 + n(p.high_priority_tasks) * 3 + n(p.open_tasks) }))
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 8)
  const max = Math.max(1, ...rows.map((p) => p.risk))
  if (!rows.length) return <Empty title="No project risk signals" detail="No open, overdue, or high-priority project load found." />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((p) => {
        const color = n(p.overdue_tasks) > 0 ? '#ef4444' : n(p.high_priority_tasks) > 0 ? '#f97316' : '#e2ab41'
        return (
          <div key={p.project_id || p.project_name} style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.project_name}</span>
              <span style={{ color, fontSize: 12, fontWeight: 950 }}>{p.risk}</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(148,163,184,.14)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(4, (p.risk / max) * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TrendSvg({ points }: { points: ProjectTrendPoint[] }) {
  const totals = useMemo(() => {
    const byDay = new Map<string, { day: string; created: number; completed: number; overdue: number }>()
    for (const p of points || []) {
      const day = String(p.day || '').slice(5, 10)
      const current = byDay.get(day) || { day, created: 0, completed: 0, overdue: 0 }
      current.created += n(p.created)
      current.completed += n(p.completed)
      current.overdue += n(p.overdue)
      byDay.set(day, current)
    }
    return Array.from(byDay.values())
  }, [points])
  const sum = totals.reduce((s, d) => s + d.created + d.completed + d.overdue, 0)
  if (!totals.length || sum === 0) return <Empty title="No project movement yet" detail="Created, completed, and overdue task movement will appear here." />

  const W = 720, H = 230, L = 34, R = 14, T = 16, B = 34
  const max = Math.max(1, ...totals.flatMap((d) => [d.created, d.completed, d.overdue]))
  const x = (i: number) => L + i * (W - L - R) / Math.max(1, totals.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const path = (key: 'created' | 'completed' | 'overdue') => totals.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[key])}`).join(' ')
  const tickEvery = Math.max(1, Math.ceil(totals.length / 6))
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="230" role="img" aria-label="Project trend">
        {[0, .25, .5, .75, 1].map((t) => {
          const yy = T + t * (H - T - B)
          return <line key={t} x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(148,163,184,.16)" strokeDasharray="4 4" />
        })}
        <path d={path('created')} fill="none" stroke="#e2ab41" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('completed')} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path('overdue')} fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
        {totals.map((d, i) => i % tickEvery === 0 || i === totals.length - 1 ? <text key={d.day} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--muted)">{d.day}</text> : null)}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>
        <span style={{ color: '#e2ab41' }}>● Created</span><span style={{ color: '#22c55e' }}>● Completed</span><span style={{ color: '#ef4444' }}>● Overdue</span>
      </div>
    </div>
  )
}

export function ProjectAnalyticsPanel() {
  const summaryQ = useQuery({ queryKey: ['projects-analytics-summary'], queryFn: fetchProjectSummary, staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const trendQ = useQuery({ queryKey: ['projects-analytics-trend'], queryFn: fetchProjectTrend, staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true })

  const projects = summaryQ.data || []
  const totalTasks = projects.reduce((s, p) => s + n(p.total_tasks), 0)
  const completedTasks = projects.reduce((s, p) => s + n(p.completed_tasks), 0)
  const openTasks = projects.reduce((s, p) => s + n(p.open_tasks), 0)
  const overdueTasks = projects.reduce((s, p) => s + n(p.overdue_tasks), 0)
  const highPriority = projects.reduce((s, p) => s + n(p.high_priority_tasks), 0)
  const completionRate = pct(completedTasks, totalTasks)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {(summaryQ.isError || trendQ.isError) && <div className="alertV4 alertV4Error">Project analytics failed to load. Available data remains visible and the app will retry automatically.</div>}
      <KpiStrip
        loading={summaryQ.isLoading}
        skeletonCount={5}
        items={[
          { label: 'Tracked Projects', value: projects.length, color: '#38bdf8', icon: <FolderOpen size={34} />, sub: 'backend analytics' },
          { label: 'Project Tasks', value: totalTasks, color: '#e2ab41', icon: <ListTodo size={34} />, sub: `${openTasks} open` },
          { label: 'Completed', value: completedTasks, color: '#22c55e', icon: <CheckCircle2 size={34} />, sub: `${completionRate}% rate` },
          { label: 'Overdue', value: overdueTasks, color: overdueTasks ? '#ef4444' : '#22c55e', icon: <AlertTriangle size={34} />, sub: 'SLA pressure' },
          { label: 'High Priority', value: highPriority, color: '#f97316', icon: <Clock3 size={34} />, sub: 'risk queue' },
        ]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <Card title="Project Completion Mix" subtitle="Backend-generated completion/open/overdue split">
          {summaryQ.isLoading ? <div className="skeleton" style={{ height: 180, borderRadius: 14 }} /> : <ProgressRows projects={projects} />}
        </Card>
        <Card title="Portfolio Risk Load" subtitle="Weighted from open, overdue, and high-priority tasks">
          {summaryQ.isLoading ? <div className="skeleton" style={{ height: 180, borderRadius: 14 }} /> : <PortfolioRisk projects={projects} />}
        </Card>
      </div>
      <Card title="Project Movement Trend" subtitle="Created, completed, and overdue movement over the last 30 days">
        {trendQ.isLoading ? <div className="skeleton" style={{ height: 230, borderRadius: 14 }} /> : <TrendSvg points={trendQ.data || []} />}
      </Card>
    </div>
  )
}
