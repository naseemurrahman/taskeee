import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { Select } from '../../components/ui/Select'

type TaskRow = { status: string; priority?: string; assigned_to_name?: string | null; due_date?: string | null; category_name?: string | null }
type WorkloadRow = { employee_id: string; employee_name: string; open_tasks: number; total_tasks: number }

const RANGE_OPTS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

function Metric({ label, value, sub, color = 'var(--brand)' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ padding: '16px', borderRadius: 14, background: 'var(--bg2)', border: '1px solid var(--border)', flex: '1 1 130px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 950, color, letterSpacing: '-1px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function InsightCard({ icon, title, body, tone = 'neutral' }: { icon: string; title: string; body: string; tone?: 'positive' | 'warning' | 'danger' | 'neutral' }) {
  const colors = { positive: '#22c55e', warning: '#f59e0b', danger: '#ef4444', neutral: 'var(--brand)' }
  const bgs    = { positive: 'rgba(34,197,94,0.08)', warning: 'rgba(245,158,11,0.08)', danger: 'rgba(239,68,68,0.08)', neutral: 'rgba(226,171,65,0.08)' }
  return (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: bgs[tone], border: `1.5px solid ${colors[tone]}22`, display: 'flex', gap: 12 }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: colors[tone], marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  )
}

export function InsightsPage() {
  const [days, setDays] = useState('30d')
  const dayNum = parseInt(days) || 30

  const tasksQ = useQuery({
    queryKey: ['insights-tasks', days],
    queryFn: () => apiFetch<{ tasks: TaskRow[] }>(`/api/v1/tasks?limit=500&page=1`).then(d => d.tasks || []),
    staleTime: 120_000,
  })

  const workloadQ = useQuery({
    queryKey: ['insights-workload'],
    queryFn: () => apiFetch<{ employees: WorkloadRow[] }>(`/api/v1/analytics/workload?days=${dayNum}`).then(d => d.employees || []),
    staleTime: 120_000,
  })

  const stats = useMemo(() => {
    const tasks = tasksQ.data || []
    if (!tasks.length) return null

    const total      = tasks.length
    const completed  = tasks.filter(t => t.status === 'completed').length
    const overdue    = tasks.filter(t => t.status === 'overdue').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const pending    = tasks.filter(t => t.status === 'pending').length
    const submitted  = tasks.filter(t => t.status === 'submitted').length
    const completionRate = total ? Math.round((completed / total) * 100) : 0
    const overdueRate    = total ? Math.round((overdue  / total) * 100) : 0

    // Priority breakdown
    const byCritical = tasks.filter(t => t.priority === 'critical').length
    const byHigh     = tasks.filter(t => t.priority === 'high').length

    // Top assignees by open tasks
    const assigneeCounts: Record<string, number> = {}
    for (const t of tasks) {
      if (t.assigned_to_name && ['pending','in_progress','overdue'].includes(t.status)) {
        assigneeCounts[t.assigned_to_name] = (assigneeCounts[t.assigned_to_name] || 0) + 1
      }
    }
    const topAssignees = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

    // Category breakdown
    const catCounts: Record<string, number> = {}
    for (const t of tasks) {
      if (t.category_name) catCounts[t.category_name] = (catCounts[t.category_name] || 0) + 1
    }
    const topCategories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

    return { total, completed, overdue, inProgress, pending, submitted, completionRate, overdueRate, byCritical, byHigh, topAssignees, topCategories }
  }, [tasksQ.data])

  const workload = workloadQ.data || []
  const overloadedPeople = workload.filter(w => w.open_tasks > 10)
  const avgOpenTasks = workload.length ? (workload.reduce((s, w) => s + w.open_tasks, 0) / workload.length).toFixed(1) : '—'

  const insights = useMemo(() => {
    if (!stats) return []
    const items: { icon: string; title: string; body: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }[] = []

    if (stats.completionRate >= 80) items.push({ icon: '🎉', title: 'Strong completion rate', body: `${stats.completionRate}% of tasks completed — your team is executing well.`, tone: 'positive' })
    else if (stats.completionRate < 50) items.push({ icon: '⚠️', title: 'Low completion rate', body: `Only ${stats.completionRate}% of tasks completed. Consider reviewing workloads and deadlines.`, tone: 'warning' })

    if (stats.overdueRate > 20) items.push({ icon: '🔴', title: 'High overdue rate', body: `${stats.overdue} tasks (${stats.overdueRate}%) are overdue. Review and reassign or extend deadlines.`, tone: 'danger' })
    else if (stats.overdue === 0) items.push({ icon: '✅', title: 'No overdue tasks', body: 'All tasks are within deadline — great scheduling discipline!', tone: 'positive' })

    if (stats.byCritical > 0) items.push({ icon: '🚨', title: `${stats.byCritical} critical priority tasks`, body: `${stats.byCritical} tasks flagged critical. Ensure these have active owners and are unblocked.`, tone: 'danger' })

    if (overloadedPeople.length > 0) items.push({ icon: '👥', title: `${overloadedPeople.length} people overloaded`, body: `${overloadedPeople.map(p => p.employee_name).join(', ')} each have 10+ open tasks. Consider redistributing.`, tone: 'warning' })

    if (stats.submitted > 0) items.push({ icon: '📋', title: `${stats.submitted} tasks awaiting review`, body: `These are submitted and waiting for manager approval. Review them to unblock your team.`, tone: 'neutral' })

    if (stats.pending > stats.inProgress * 2) items.push({ icon: '📌', title: 'Many tasks not started', body: `${stats.pending} tasks are still pending vs ${stats.inProgress} in progress. Triage the backlog.`, tone: 'warning' })

    if (items.length === 0) items.push({ icon: '📊', title: 'Operations look healthy', body: 'No significant issues detected. Keep monitoring as tasks progress.', tone: 'positive' })
    return items
  }, [stats, overloadedPeople])

  const loading = tasksQ.isLoading || workloadQ.isLoading

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Insights
            </div>
            <div className="pageHeaderCardSub">Real-time performance analysis computed from your task data</div>
          </div>
          <div style={{ minWidth: 150 }}>
            <Select value={days} onChange={setDays} options={RANGE_OPTS} />
          </div>
        </div>
      </div>

      {loading && <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>Analyzing task data…</div>}

      {!loading && stats && (
        <>
          {/* KPI row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Metric label="Total Tasks"      value={stats.total}          sub="in your org" />
            <Metric label="Completed"        value={stats.completed}      sub={`${stats.completionRate}% rate`} color="#22c55e" />
            <Metric label="In Progress"      value={stats.inProgress}     sub="active now" color="#8b5cf6" />
            <Metric label="Overdue"          value={stats.overdue}        sub={`${stats.overdueRate}% of total`} color={stats.overdue > 0 ? '#ef4444' : '#22c55e'} />
            <Metric label="Avg Open / Person" value={avgOpenTasks}        sub="workload balance" color="#f59e0b" />
          </div>

          {/* AI-style Insights */}
          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🤖</span> Smart Insights
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginLeft: 4 }}>• computed locally from {stats.total} tasks</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
            </div>
          </div>

          {/* Top Assignees */}
          {stats.topAssignees.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 12 }}>👥 Heaviest open workload</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {stats.topAssignees.map(([name, count]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brandDim)', border: '1.5px solid var(--brandBorder)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, color: 'var(--brand)', flexShrink: 0 }}>
                      {name.split(' ').map(s => s[0]).slice(0, 2).join('')}
                    </div>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--bg2)', flex: '0 0 120px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: count > 10 ? '#ef4444' : count > 5 ? '#f59e0b' : '#22c55e', width: `${Math.min(100, count * 8)}%` }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--text2)', minWidth: 28, textAlign: 'right' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Projects */}
          {stats.topCategories.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 12 }}>📁 Tasks by project</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {stats.topCategories.map(([name, count]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--bg2)', flex: '0 0 160px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: 'var(--brand)', width: `${Math.min(100, (count / (stats?.total || 1)) * 100 * 2)}%` }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--text2)', minWidth: 28, textAlign: 'right' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !stats && (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>No task data yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>Create tasks and assign them to your team to see insights here.</div>
        </div>
      )}
    </div>
  )
}
