import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { Modal } from '../../components/Modal'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { useRealtimeInvalidation } from '../../lib/socket'

type Task = {
  id: string
  title: string
  status: string
  due_date?: string | null
  assigned_to_name?: string | null
  category_name?: string | null
  category_color?: string | null
}

type Project = {
  id: string
  name: string
  description?: string | null
  created_at: string
  color?: string | null
}

async function fetchDatedTasks() {
  const qs = new URLSearchParams({ limit: '200', page: '1' })
  const data = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?${qs.toString()}`)
  return (data.tasks || data.rows || []) as Task[]
}

async function fetchProjects() {
  const data = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
  return data.projects || []
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function ymd(d: Date) {
  const x = startOfDay(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type DayBucket = { date: Date; tasks: Task[]; projects: Project[] }

function firstAccentColor(bucket: DayBucket | null | undefined) {
  if (!bucket) return undefined
  for (const t of bucket.tasks) {
    const c = t.category_color?.trim()
    if (c) return c
  }
  for (const p of bucket.projects) {
    const c = p.color?.trim()
    if (c) return c
  }
  return undefined
}

export function CalendarPage() {
  const me = getUser()
  const qc = useQueryClient()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [pick, setPick] = useState<DayBucket | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDueDate, setCreateDueDate] = useState<string | null>(null)
  useRealtimeInvalidation({ tasks: true })

  const tq = useQuery({ queryKey: ['calendar', 'tasks'], queryFn: fetchDatedTasks })
  const pq = useQuery({ queryKey: ['calendar', 'projects'], queryFn: fetchProjects })

  const tasks = tq.data || []
  const projects = pq.data || []

  const { cells } = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const first = new Date(year, month, 1)
    const startPad = first.getDay()
    const lastDay = new Date(year, month + 1, 0).getDate()
    const map = new Map<string, DayBucket>()

    function ensure(d: Date) {
      const k = ymd(d)
      if (!map.has(k)) map.set(k, { date: startOfDay(d), tasks: [], projects: [] })
      return map.get(k)!
    }

    for (const t of tasks) {
      if (!t.due_date) continue
      const d = startOfDay(new Date(t.due_date))
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      ensure(d).tasks.push(t)
    }

    for (const p of projects) {
      if (!p.created_at) continue
      const d = startOfDay(new Date(p.created_at))
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      ensure(d).projects.push(p)
    }

    const cells: Array<{ date: Date | null; bucket: DayBucket | null }> = []
    for (let i = 0; i < startPad; i++) {
      const d = new Date(year, month, -(startPad - 1 - i))
      cells.push({ date: d, bucket: null })
    }
    for (let day = 1; day <= lastDay; day++) {
      const d = new Date(year, month, day)
      const k = ymd(d)
      cells.push({ date: d, bucket: map.get(k) || { date: startOfDay(d), tasks: [], projects: [] } })
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date!
      const next = new Date(last)
      next.setDate(next.getDate() + 1)
      cells.push({ date: next, bucket: null })
    }

    return { cells }
  }, [cursor, tasks, projects])

  const label = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="calShell">
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Calendar
            </div>
            <div className="pageHeaderCardSub">Monthly calendar view of all task due dates. Click any day to see tasks due that day. Color coded by overdue, due today, or upcoming.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📅</span> Monthly view</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🎯</span> Due date tracking</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>⚠️</span> Overdue alerts</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button" className="btn btnGhost"
              style={{ height: 36, width: 36, padding: 0, display: 'grid', placeItems: 'center', borderRadius: 10 }}
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              title="Previous month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.3px', minWidth: 140, textAlign: 'center' }}>
              {label}
            </div>
            <button
              type="button" className="btn btnGhost"
              style={{ height: 36, width: 36, padding: 0, display: 'grid', placeItems: 'center', borderRadius: 10 }}
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              title="Next month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button
              type="button" className="btn btnPrimary"
              style={{ height: 36, padding: '0 14px', fontSize: 12, fontWeight: 750, marginLeft: 4 }}
              onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            >
              Today
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {tq.isLoading || pq.isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)', padding: '8px 0' }}>
            <div style={{ width: 16, height: 16, border: '2px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            Loading calendar…
          </div>
        ) : null}
        {tq.isError ? <div className="alert alertError">Failed to load tasks.</div> : null}
        {pq.isError ? <div className="alert alertError">Failed to load projects.</div> : null}

        <div className="calMonthGrid" role="grid" aria-label="Calendar month">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calWeekday">
              {w}
            </div>
          ))}
          {cells.map((c, idx) => {
            if (!c.date) return <div key={`empty-${idx}`} />
            const date = c.date as Date
            const inMonth = date.getMonth() === cursor.getMonth()
            const isToday = ymd(date) === ymd(new Date())
            const cellKey = date.toISOString()
            const accent = inMonth ? firstAccentColor(c.bucket) : undefined
            const cellStyle: CSSProperties | undefined =
              accent && inMonth
                ? {
                    borderColor: accent,
                    borderWidth: 2,
                    boxShadow: `inset 0 0 0 1px ${accent}40`,
                  }
                : undefined

            const dotItems: Array<{ key: string; color: string; title: string }> = []
            if (c.bucket && inMonth) {
              for (const t of c.bucket.tasks.slice(0, 5)) {
                dotItems.push({
                  key: `t-${t.id}`,
                  color: t.category_color?.trim() || 'rgba(244, 202, 87, 0.9)',
                  title: t.title,
                })
              }
              for (const p of c.bucket.projects.slice(0, 3)) {
                dotItems.push({
                  key: `p-${p.id}`,
                  color: p.color?.trim() || 'rgba(56, 189, 248, 0.9)',
                  title: p.name,
                })
              }
            }

            return (
              <button
                key={cellKey}
                type="button"
                className={`calCell ${!inMonth ? 'calCellMuted' : ''} ${isToday ? 'calCellToday' : ''}`}
                style={cellStyle}
                disabled={!inMonth}
                onClick={() => {
                  if (!inMonth) return
                  if (c.bucket) { setPick(c.bucket); return }
                  // Click on empty in-month day: open create task with due date
                  if (canCreate) {
                    setCreateDueDate(ymd(date))
                    setCreateOpen(true)
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="calCellNum">{date.getDate()}</div>
                  {inMonth && canCreate && (
                    <button
                      type="button"
                      className="calCellAddBtn"
                      title="Create task on this date"
                      onClick={e => {
                        e.stopPropagation()
                        setCreateDueDate(ymd(date))
                        setCreateOpen(true)
                      }}
                    >+</button>
                  )}
                </div>
                {dotItems.length > 0 && inMonth ? (
                  <div className="calCellDots" aria-hidden>
                    {dotItems.map((d) => (
                      <span key={d.key} className="calDot" style={{ background: d.color }} title={d.title} />
                    ))}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <Modal
        title={pick ? pick.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}
        open={!!pick}
        wide
        onClose={() => setPick(null)}
      >
        {pick ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 8 }}>TASKS DUE</div>
              {pick.tasks.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pick.tasks.map((t) => {
                    const taskColor = t.category_color?.trim() || '#e2ab41'
                    return (
                      <div key={t.id} className="miniCard" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'flex' }}>
                          <div style={{ width: 4, background: taskColor, flexShrink: 0 }} />
                          <div style={{ padding: '10px 12px', flex: 1 }}>
                            <div style={{ fontWeight: 800 }}>{t.title}</div>
                            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                              {t.category_name ? `${t.category_name} · ` : ''}
                              {t.assigned_to_name || '—'} · {t.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>No tasks due this day.</div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 8 }}>PROJECTS (START DATE)</div>
              {pick.projects.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pick.projects.map((p) => {
                    const projColor = p.color?.trim() || '#38bdf8'
                    return (
                      <div key={p.id} className="miniCard" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'flex' }}>
                          <div style={{ width: 4, background: projColor, flexShrink: 0 }} />
                          <div style={{ padding: '10px 12px', flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: '50%', background: projColor, flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontWeight: 900 }}>{p.name}</span>
                            </div>
                            {p.description ? <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>{p.description}</div> : null}
                            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Started {new Date(p.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>No projects started this day.</div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {canCreate && (
        <CreateTaskModal
          open={createOpen}
          initialDueDate={createDueDate}
          onClose={() => { setCreateOpen(false); setCreateDueDate(null); qc.invalidateQueries({ queryKey: ['calendar'] }) }}
        />
      )}
    </div>
  )
}
