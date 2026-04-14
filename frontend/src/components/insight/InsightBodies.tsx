import { Link } from 'react-router-dom'
import { StatusBarChart } from '../charts/PerformanceCharts'
import type { TaskLite } from './types'

export type KpiNumbers = {
  total: number
  inProgress: number
  completed: number
  overdue: number
}

export function KpiStrip(props: KpiNumbers) {
  return (
    <div className="grid4">
      <div className="miniCard">
        <div className="miniLabel">Total</div>
        <div className="miniValue">{props.total}</div>
      </div>
      <div className="miniCard">
        <div className="miniLabel">In progress</div>
        <div className="miniValue">{props.inProgress}</div>
      </div>
      <div className="miniCard">
        <div className="miniLabel">Completed</div>
        <div className="miniValue">{props.completed}</div>
      </div>
      <div className="miniCard">
        <div className="miniLabel">Overdue</div>
        <div className="miniValue" style={{ color: 'rgba(239, 68, 68, 0.92)' }}>
          {props.overdue}
        </div>
      </div>
    </div>
  )
}

export function TaskSampleTable(props: { tasks: TaskLite[]; empty?: string }) {
  const rows = props.tasks.slice(0, 12)
  if (!rows.length) {
    return <div style={{ color: 'var(--text2)' }}>{props.empty || 'No tasks in this slice.'}</div>
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--text2)' }}>Recent tasks</div>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title || t.id}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                {[t.category_name, t.assigned_to_name].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <span className="pill pillMuted">{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectsBreakdownTable(props: { rows: Array<{ name: string; done: number; remaining: number }> }) {
  if (!props.rows.length) return <div style={{ color: 'var(--text2)' }}>No project breakdown yet.</div>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--text2)' }}>By project</div>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, overflow: 'hidden' }}>
        {props.rows.slice(0, 14).map((r) => {
          const sum = r.done + r.remaining
          const pct = sum ? Math.round((r.done / sum) * 100) : 0
          return (
            <div
              key={r.name}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 850 }}>{r.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{pct}% · {sum} tasks</div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 8,
                  borderRadius: 999,
                  border: '1px solid rgba(17,24,39,0.10)',
                  background: 'rgba(17,24,39,0.06)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(109, 94, 252, 0.55)' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AssignmentsBreakdownTable(props: {
  rows: Array<{ name: string; active: number; overdue: number; done: number }>
}) {
  if (!props.rows.length) return <div style={{ color: 'var(--text2)' }}>No assignment data.</div>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--text2)' }}>By assignee</div>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, overflow: 'hidden' }}>
        {props.rows.slice(0, 14).map((r) => (
          <div
            key={r.name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontWeight: 850, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12, flexShrink: 0 }}>
              active {r.active} · overdue {r.overdue} · done {r.done}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PriorityBreakdown(props: { byPriority: Record<string, number> }) {
  const entries = Object.entries(props.byPriority).filter(([, n]) => n > 0)
  if (!entries.length) return <div style={{ color: 'var(--text2)' }}>No priority labels on tasks.</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {entries.map(([k, v]) => (
        <span key={k} className="pill pillMuted">
          {k}: {v}
        </span>
      ))}
    </div>
  )
}

export function StatusMiniChart(props: { byStatus: Record<string, number> }) {
  return (
    <div style={{ minHeight: 200 }}>
      <StatusBarChart byStatus={props.byStatus} />
    </div>
  )
}

export function ModalFooterOpenTasks(props: { href: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Link
        className="btn btnGhost"
        style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }}
        to={props.href}
        onClick={() => props.onClose()}
      >
        Open in tasks
      </Link>
    </div>
  )
}
