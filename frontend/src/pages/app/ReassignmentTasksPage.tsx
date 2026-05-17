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

      <div className="chartV3" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 160 }}>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search held tasks…" />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <Select value={assigneeId} onChange={setAssigneeId} options={assigneeOptions} />
          </div>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={!assigneeId || selectedTasks.length === 0 || reassignM.isPending}
            onClick={() => reassignM.mutate()}
          >
            {reassignM.isPending ? 'Reassigning…' : `Reassign ${selectedTasks.length || ''}`.trim()}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Select tasks, choose an active employee, then reassign. Reassigned tasks are returned to Pending for normal workflow.
        </div>
        {usersQ.isError && (
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
            Could not load assignable users. Refresh the page or check your permissions.
          </div>
        )}
      </div>

      <div className="chartV3" style={{ padding: 0, overflow: 'hidden' }}>
        {tasksQ.isLoading ? (
          <div style={{ padding: 16 }}><SkeletonRows count={6} /></div>
        ) : tasksQ.isError ? (
          <ErrorRetry queryKey={['tasks', 'reassignment-needed']} message="Could not load reassignment tasks. Check your connection and try again." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={14} />}
            title={search ? 'No reassignment tasks match your search' : 'No tasks need reassignment'}
            sub={search ? 'Clear the search to view all held tasks.' : 'Inactive employee and paused-project tasks will appear here when action is needed.'}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tasksTable" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="thCheckbox"><input type="checkbox" className="taskCheckbox" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
                  <th className="thCell">Task</th>
                  <th className="thCell">Current assignee</th>
                  <th className="thCell">Project</th>
                  <th className="thCell">Status</th>
                  <th className="thCell">Priority</th>
                  <th className="thCell">Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(task => {
                  const checked = selectedTaskIds.has(task.id)
                  return (
                    <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', background: checked ? 'rgba(226,171,65,0.07)' : undefined }}>
                      <td className="thCheckbox"><input type="checkbox" className="taskCheckbox" checked={checked} onChange={() => toggleTask(task.id)} /></td>
                      <td style={{ padding: '11px 14px', fontWeight: 800 }}>{task.title || task.id}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{task.assigned_to_name || 'Unavailable assignee'}</div>
                        {task.assigned_to_email && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{task.assigned_to_email}</div>}
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        {task.category_name ? <span style={{ fontSize: 12, fontWeight: 800, color: task.category_color || 'var(--text2)' }}>{task.category_name}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '11px 14px', textTransform: 'capitalize', color: '#f59e0b', fontWeight: 800 }}>{statusLabel(task.status)}</td>
                      <td style={{ padding: '11px 14px', textTransform: 'capitalize' }}>{task.priority || '—'}</td>
                      <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>{fmtDate(task.due_date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
