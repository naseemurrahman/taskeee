import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeftRight, ClipboardList, Users } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/ToastSystem'
import { EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui/PageStates'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { KpiStrip } from '../../components/ui/KpiCard'
import { useRealtimeInvalidation } from '../../lib/socket'

type Task = {
  id: string
  title?: string | null
  status?: string | null
  priority?: string | null
  due_date?: string | null
  category_name?: string | null
  category_color?: string | null
  assigned_to?: string | null
  assigned_to_name?: string | null
  assigned_to_email?: string | null
}

type AssignableUser = { id: string; name: string; email?: string; role?: string; department?: string }

function fetchReassignmentTasks() {
  return apiFetch<{ tasks: Task[] }>('/api/v1/tasks/reassignment-needed').then(d => d.tasks || [])
}

function fetchAssignableUsers() {
  return apiFetch<{ users: AssignableUser[] }>('/api/v1/tasks/assignable-users').then(d => d.users || [])
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusLabel(value?: string | null) {
  return String(value || 'pending').replace(/_/g, ' ')
}

const PRIORITY_COLOR: Record<string, string> = {
  low: '#38bdf8', medium: '#8B5CF6', high: '#f97316', critical: '#ef4444', urgent: '#ef4444',
}

export function ReassignmentTasksPage() {
  const me = getUser()
  const canManage = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  const [search, setSearch] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [assigneeId, setAssigneeId] = useState('')

  useRealtimeInvalidation({ tasks: true, employees: true })

  const tasksQ = useQuery({
    queryKey: ['tasks', 'reassignment-needed'],
    queryFn: fetchReassignmentTasks,
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: canManage,
  })

  const usersQ = useQuery({
    queryKey: ['tasks-assignable-users', 'reassignment'],
    queryFn: fetchAssignableUsers,
    staleTime: 60_000,
    enabled: canManage,
  })

  const tasks = tasksQ.data || []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tasks
    return tasks.filter(t => [t.title, t.assigned_to_name, t.assigned_to_email, t.category_name, t.status, t.priority]
      .some(v => String(v || '').toLowerCase().includes(s)))
  }, [tasks, search])

  const selectedTasks = useMemo(() => filtered.filter(t => selectedTaskIds.has(t.id)), [filtered, selectedTaskIds])
  const allVisibleSelected = filtered.length > 0 && filtered.every(t => selectedTaskIds.has(t.id))
  const onHoldCount = useMemo(() => tasks.filter(t => t.status === 'on_hold').length, [tasks])

  const assigneeOptions = [
    { value: '', label: usersQ.isLoading ? 'Loading employees…' : 'Select active employee' },
    ...(usersQ.data || []).map(u => ({ value: u.id, label: `${u.name}${u.role ? ` · ${u.role}` : ''}` })),
  ]

  const reassignM = useMutation({
    mutationFn: async () => {
      if (!assigneeId) throw new Error('Select an active employee first')
      const ids = selectedTasks.map(t => t.id)
      if (!ids.length) throw new Error('Select at least one task')
      const res = await apiFetch<{ updatedCount: number; tasks: Task[] }>('/api/v1/tasks/reassign', {
        method: 'POST',
        json: { taskIds: ids, assigned_to: assigneeId, status: 'pending' },
      })
      return res.updatedCount || ids.length
    },
    onSuccess: (count) => {
      toastSuccess('Tasks reassigned', `${count} task${count === 1 ? '' : 's'} moved back to Pending.`)
      setSelectedTaskIds(new Set())
      setAssigneeId('')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks', 'reassignment-needed'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err: { message?: string }) => toastError('Reassignment failed', err?.message || 'Could not reassign selected tasks'),
  })

  function toggleTask(id: string) {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach(t => next.delete(t.id))
      else filtered.forEach(t => next.add(t.id))
      return next
    })
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={<ClipboardList size={14} />}
        title="Reassignment is restricted"
        sub="Only supervisors, managers, HR, directors, and admins can manage reassignment tasks."
      />
    )
  }

  const tableContent = tasksQ.isLoading ? (
    <div style={{ padding: 16 }}><SkeletonRows count={6} /></div>
  ) : tasksQ.isError ? (
    <ErrorRetry queryKey={['tasks', 'reassignment-needed']} message="Could not load reassignment tasks." />
  ) : filtered.length === 0 ? (
    <EmptyState
      icon={<ClipboardList size={14} />}
      title={search ? 'No reassignment tasks match your search' : 'No tasks need reassignment'}
      sub={search ? 'Clear the search to view all held tasks.' : 'Inactive employee and paused-project tasks will appear here when action is needed.'}
    />
  ) : null

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <PageHeaderCard
        icon={<ArrowLeftRight size={20} strokeWidth={2} />}
        title="Needs Reassignment"
        subtitle="Tasks on hold because the assignee or project state requires management review."
        badges={[
          { label: `${tasks.length} held`, color: '#f59e0b' },
          ...(selectedTasks.length > 0 ? [{ label: `${selectedTasks.length} selected`, color: '#e2ab41' }] : []),
        ]}
        actions={<Link to="/app/tasks" className="btn btnGhost" style={{ textDecoration: 'none' }}>Back to Tasks</Link>}
      />

      <KpiStrip
        loading={tasksQ.isLoading}
        items={[
          { label: 'Needs Reassignment', value: tasks.length, color: '#f59e0b', icon: <AlertTriangle size={36} />, sub: 'held tasks' },
          { label: 'On Hold', value: onHoldCount, color: '#a855f7', icon: <ClipboardList size={36} />, sub: 'status on_hold' },
          { label: 'Selected', value: selectedTasks.length, color: '#6366f1', icon: <Users size={36} />, sub: 'ready to reassign' },
          { label: 'Assignable Staff', value: usersQ.data?.length || 0, color: '#22c55e', icon: <Users size={36} />, sub: 'active employees' },
        ]}
      />

      {/* ── Filter / action bar — height fits content ── */}
      <div className="chartV3" style={{ padding: 14, alignSelf: 'start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search held tasks…" />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <Select value={assigneeId} onChange={setAssigneeId} options={assigneeOptions} />
          </div>
          <button
            type="button"
            className="btn btnPrimary"
            style={{ flexShrink: 0 }}
            disabled={!assigneeId || selectedTasks.length === 0 || reassignM.isPending}
            onClick={() => reassignM.mutate()}
          >
            {reassignM.isPending ? 'Reassigning…' : selectedTasks.length > 0 ? `Reassign ${selectedTasks.length}` : 'Reassign'}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Select tasks below, choose an active employee, then click Reassign. Tasks return to Pending status.
        </div>
        {usersQ.isError && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
            Could not load assignable users. Refresh or check your permissions.
          </div>
        )}
      </div>

      {/* ── Table card ── */}
      <div className="chartV3" style={{ padding: 0, overflow: 'hidden' }}>
        {tableContent ?? (
          <>
            {/* Desktop table */}
            <div className="reassignDesktop" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="thCheckbox" onClick={e => { e.stopPropagation(); toggleAllVisible() }}>
                      <input type="checkbox" className="taskCheckbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                    </th>
                    <th className="thCell">Task</th>
                    <th className="thCell">Current Assignee</th>
                    <th className="thCell">Project</th>
                    <th className="thCell">Status</th>
                    <th className="thCell">Priority</th>
                    <th className="thCell">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(task => {
                    const checked = selectedTaskIds.has(task.id)
                    const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
                    return (
                      <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', background: checked ? 'rgba(226,171,65,0.07)' : undefined }}>
                        <td className="thCheckbox" onClick={e => { e.stopPropagation(); toggleTask(task.id) }}>
                          <input type="checkbox" className="taskCheckbox" checked={checked} onChange={() => toggleTask(task.id)} />
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 800, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || task.id}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 12, fontWeight: 800 }}>{task.assigned_to_name || 'Unavailable'}</div>
                          {task.assigned_to_email && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{task.assigned_to_email}</div>}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {task.category_name
                            ? <span style={{ fontSize: 12, fontWeight: 800, color: task.category_color || 'var(--text2)' }}>{task.category_name}</span>
                            : <span style={{ color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', textTransform: 'capitalize', color: '#f59e0b', fontWeight: 800, whiteSpace: 'nowrap' }}>{statusLabel(task.status)}</td>
                        <td style={{ padding: '11px 14px', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                          {task.priority ? <span style={{ color: pColor, fontWeight: 800 }}>{task.priority}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtDate(task.due_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="reassignMobile">
              {/* Select-all row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" className="taskCheckbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {allVisibleSelected ? 'Deselect all' : `Select all (${filtered.length})`}
                </span>
              </div>
              {filtered.map(task => {
                const checked = selectedTaskIds.has(task.id)
                const pColor = PRIORITY_COLOR[task.priority || ''] || 'var(--muted)'
                return (
                  <div
                    key={task.id}
                    style={{ borderBottom: '1px solid var(--border)', background: checked ? 'rgba(226,171,65,0.06)' : undefined, cursor: 'pointer' }}
                    onClick={() => toggleTask(task.id)}
                  >
                    <div style={{ display: 'flex', gap: 12, padding: '14px 14px 12px', alignItems: 'flex-start' }}>
                      {/* Checkbox */}
                      <div onClick={e => e.stopPropagation()} style={{ paddingTop: 2, flexShrink: 0 }}>
                        <input type="checkbox" className="taskCheckbox" checked={checked} onChange={() => toggleTask(task.id)} />
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6, lineHeight: 1.3 }}>{task.title || task.id}</div>
                        {/* Assignee */}
                        <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700, marginBottom: 4 }}>
                          👤 {task.assigned_to_name || 'Unavailable'}
                          {task.assigned_to_email && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · {task.assigned_to_email}</span>}
                        </div>
                        {/* Pills row */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {task.category_name && (
                            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: (task.category_color || '#6366f1') + '18', color: task.category_color || '#818cf8', border: `1px solid ${(task.category_color || '#6366f1')}28` }}>
                              {task.category_name}
                            </span>
                          )}
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.24)', textTransform: 'capitalize' }}>
                            {statusLabel(task.status)}
                          </span>
                          {task.priority && (
                            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: pColor + '18', color: pColor, border: `1px solid ${pColor}28`, textTransform: 'capitalize' }}>
                              {task.priority}
                            </span>
                          )}
                          {task.due_date && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>📅 {fmtDate(task.due_date)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
