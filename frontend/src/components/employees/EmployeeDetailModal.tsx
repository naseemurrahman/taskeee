import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../Modal'
import { apiFetch } from '../../lib/api'
import { avatarDisplaySrc, normalizeAvatarUrl } from '../../lib/avatarUrl'
import { AssignmentsBreakdownTable, KpiStrip, StatusMiniChart, TaskSampleTable } from '../insight/InsightBodies'
import type { TaskLite } from '../insight/types'

type UserDetail = {
  id: string
  email: string
  full_name: string
  role: string
  department?: string | null
  employee_code?: string | null
  manager_name?: string | null
  last_login_at?: string | null
  created_at?: string | null
  avatar_url?: string | null
}

async function fetchUser(id: string) {
  return await apiFetch<{ user: UserDetail }>(`/api/v1/users/${encodeURIComponent(id)}`)
}

async function fetchTasksForUser(userId: string) {
  const qs = new URLSearchParams({ limit: '120', page: '1', userId })
  const data = await apiFetch<{ tasks?: TaskLite[]; rows?: TaskLite[] }>(`/api/v1/tasks?${qs.toString()}`)
  return (data.tasks || data.rows || []) as TaskLite[]
}

function countByStatus(tasks: TaskLite[]) {
  const out: Record<string, number> = {}
  for (const t of tasks) {
    const s = String(t.status || '')
    out[s] = (out[s] || 0) + 1
  }
  return out
}

export function EmployeeDetailModal(props: { userId: string | null; onClose: () => void }) {
  const open = !!props.userId
  const uid = props.userId || ''

  const userQ = useQuery({
    queryKey: ['employeeModal', 'user', uid],
    queryFn: () => fetchUser(uid),
    enabled: open,
  })
  const tasksQ = useQuery({
    queryKey: ['employeeModal', 'tasks', uid],
    queryFn: () => fetchTasksForUser(uid),
    enabled: open,
  })

  const tasks = tasksQ.data || []
  const by = useMemo(() => countByStatus(tasks), [tasks])
  const total = tasks.length
  const completed = (by.completed || 0) + (by.manager_approved || 0)
  const overdue = by.overdue || 0
  const inProgress = (by.in_progress || 0) + (by.pending || 0) + (by.submitted || 0)
  const completionPct = total ? Math.round((completed / total) * 100) : 0

  const assignmentRow = useMemo(() => {
    const name = userQ.data?.user.full_name || userQ.data?.user.email || 'This person'
    const active = tasks.filter((t) => !['completed', 'manager_approved'].includes(t.status) && t.status !== 'overdue').length
    const od = tasks.filter((t) => t.status === 'overdue').length
    const done = tasks.filter((t) => t.status === 'completed' || t.status === 'manager_approved').length
    return [{ name, active, overdue: od, done }]
  }, [tasks, userQ.data?.user])

  const u = userQ.data?.user
  const rawAvatar = u?.avatar_url ?? null
  const empAvatarOk = !!normalizeAvatarUrl(rawAvatar)
  const empAvatarSrc = avatarDisplaySrc(rawAvatar, userQ.dataUpdatedAt)
  const [empAvatarBroken, setEmpAvatarBroken] = useState(false)
  useEffect(() => {
    setEmpAvatarBroken(false)
  }, [rawAvatar])

  return (
    <Modal
      title={u?.full_name || u?.email || 'Team member'}
      open={open}
      onClose={props.onClose}
      wide
      footer={null}
    >
      {userQ.isLoading || tasksQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
      {userQ.isError ? <div className="alert alertError">Could not load this profile.</div> : null}
      {u ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.05)',
                flexShrink: 0,
              }}
            >
              {empAvatarOk && !empAvatarBroken ? (
                <img
                  src={empAvatarSrc}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setEmpAvatarBroken(true)}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontWeight: 950 }}>
                  {(u.full_name || u.email).slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 950, letterSpacing: '-0.3px' }}>{u.full_name}</div>
              <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
                {u.email} · {u.role}
                {u.department ? ` · ${u.department}` : ''}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                Manager: {u.manager_name || '—'}
                {u.last_login_at ? ` · Last login ${new Date(u.last_login_at).toLocaleString()}` : ''}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill pillMuted">Completion {completionPct}%</span>
              <span className="pill">{total} assigned</span>
            </div>
          </div>

          <KpiStrip total={total} inProgress={inProgress} completed={completed} overdue={overdue} />

          <div className="grid2" style={{ alignItems: 'start' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Status</div>
              <StatusMiniChart byStatus={by} />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Workload</div>
              <AssignmentsBreakdownTable rows={assignmentRow} />
            </div>
          </div>

          <TaskSampleTable tasks={tasks} empty="No tasks assigned in your current scope." />
        </div>
      ) : null}
    </Modal>
  )
}
