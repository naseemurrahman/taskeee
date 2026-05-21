import { useQuery } from '@tanstack/react-query'
import { FolderOpen, AlertTriangle, CheckCircle2, Clock3, ListTodo } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { liveAnalyticsQueryOptions } from '../../lib/analyticsQueryOptions'
import { useRealtimeInvalidation } from '../../lib/socket'
import { KpiStrip } from '../ui/KpiCard'
import { AnalyticsCard, AnalyticsErrorNotice, AnalyticsLoadingBlock, AnalyticsTrendLineChart, EmptyAnalyticsState, numberValue as n, percent as pct } from '../analytics/AnalyticsPrimitives'

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

async function fetchProjectSummary() {
  const data = await apiFetch<{ projects: ProjectSummary[] }>('/api/v1/analytics/project-summary?days=90')
  return data.projects || []
}

async function fetchProjectTrend() {
  const data = await apiFetch<{ points: ProjectTrendPoint[] }>('/api/v1/analytics/project-trend?days=30')
  return data.points || []
}

function ProgressRows({ projects }: { projects: ProjectSummary[] }) {
  const rows = projects.filter((p) => n(p.total_tasks) > 0).slice(0, 8)
  if (!rows.length) return <EmptyAnalyticsState title="No project progress yet" detail="No project analytics for the selected period." minHeight={120} />
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
  if (!rows.length) return <EmptyAnalyticsState title="No project risk signals" detail="No open, overdue, or high-priority project load found." minHeight={120} />
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

function TrendChart({ points }: { points: ProjectTrendPoint[] }) {
  const byDay = new Map<string, { day: string; created: number; completed: number; overdue: number }>()
  for (const p of points || []) {
    const key = String(p.day || '')
    const current = byDay.get(key) || { day: key, created: 0, completed: 0, overdue: 0 }
    current.created += n(p.created)
    current.completed += n(p.completed)
    current.overdue += n(p.overdue)
    byDay.set(key, current)
  }
  return (
    <AnalyticsTrendLineChart
      points={Array.from(byDay.values())}
      keys={['created', 'completed', 'overdue']}
      labels={{ created: 'Created', completed: 'Completed', overdue: 'Overdue' }}
      colors={{ created: '#e2ab41', completed: '#22c55e', overdue: '#ef4444' }}
      emptyTitle="No project movement yet"
      emptyDetail="Created, completed, and overdue task movement will appear here."
      height={230}
      ariaLabel="Project trend"
    />
  )
}

export function ProjectAnalyticsPanel() {
  useRealtimeInvalidation({ tasks: true, employees: true, dashboard: true })
  const summaryQ = useQuery(liveAnalyticsQueryOptions<ProjectSummary[]>({ queryKey: ['projects-analytics-summary'], queryFn: fetchProjectSummary }))
  const trendQ = useQuery(liveAnalyticsQueryOptions<ProjectTrendPoint[]>({ queryKey: ['projects-analytics-trend'], queryFn: fetchProjectTrend }))

  const projects = summaryQ.data || []
  const totalTasks = projects.reduce((s, p) => s + n(p.total_tasks), 0)
  const completedTasks = projects.reduce((s, p) => s + n(p.completed_tasks), 0)
  const openTasks = projects.reduce((s, p) => s + n(p.open_tasks), 0)
  const overdueTasks = projects.reduce((s, p) => s + n(p.overdue_tasks), 0)
  const highPriority = projects.reduce((s, p) => s + n(p.high_priority_tasks), 0)
  const completionRate = pct(completedTasks, totalTasks)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {(summaryQ.isError || trendQ.isError) && <AnalyticsErrorNotice message="Project analytics failed to load. Available data remains visible and the app will retry automatically." />}
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
        <AnalyticsCard title="Project Completion Mix" subtitle="Backend-generated completion/open/overdue split">
          {summaryQ.isLoading ? <AnalyticsLoadingBlock height={180} /> : <ProgressRows projects={projects} />}
        </AnalyticsCard>
        <AnalyticsCard title="Portfolio Risk Load" subtitle="Weighted from open, overdue, and high-priority tasks">
          {summaryQ.isLoading ? <AnalyticsLoadingBlock height={180} /> : <PortfolioRisk projects={projects} />}
        </AnalyticsCard>
      </div>
      <AnalyticsCard title="Project Movement Trend" subtitle="Created, completed, and overdue movement over the last 30 days">
        {trendQ.isLoading ? <AnalyticsLoadingBlock height={230} /> : <TrendChart points={trendQ.data || []} />}
      </AnalyticsCard>
    </div>
  )
}
