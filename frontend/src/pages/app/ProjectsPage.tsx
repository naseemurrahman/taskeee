import { useMemo, useState, useRef, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import { IconFolder } from '../../components/ui/AppIcons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { useRealtimeInvalidation } from '../../lib/socket'
import { ProjectDetailModal } from '../../components/projects/ProjectDetailModal'
import { Modal } from '../../components/Modal'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/ToastSystem'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { PageLiveCharts } from '../../components/charts/PageLiveCharts'
import { KpiStrip } from '../../components/ui/KpiCard'
import { FolderOpen, CircleDot, ListTodo } from 'lucide-react'

type Project = {
  id: string
  name: string
  description?: string | null
  color?: string | null
  status?: 'active' | 'paused' | 'completed'
  task_count?: number
  progress?: number
}

type ActiveTask = {
  id: string
  title: string
  status: string
  priority?: string | null
  due_date?: string | null
  assignee_name?: string | null
}

type StatusChangeTarget = { project: Project; targetStatus: 'active' | 'paused' | 'completed' }
type ProjectStatusChangeResponse = {
  project?: Project
  canonicalProjectId?: string
  requestedProjectId?: string
  requestedProjectName?: string
}

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
  return d.projects || []
}

async function fetchActiveTasks(projectId: string): Promise<ActiveTask[]> {
  const d = await apiFetch<{ tasks: ActiveTask[] }>(`/api/v1/projects/${projectId}/active-tasks`)
  return d.tasks || []
}

async function createProject(input: { name: string; description?: string; color?: string }) {
  return apiFetch<{ project: Project }>('/api/v1/projects', { method: 'POST', json: input })
}

async function renameProject(id: string, name: string) {
  return apiFetch(`/api/v1/projects/${id}`, { method: 'PATCH', json: { name } })
}

async function changeProjectStatus(id: string, status: 'active' | 'paused' | 'completed', projectName?: string, opts?: { force?: boolean }) {
  const body: Record<string, unknown> = { status }
  if (projectName) body.project_name = projectName
  if (opts?.force) body.force_pause = true
  return apiFetch<ProjectStatusChangeResponse>(`/api/v1/projects/${id}`, { method: 'PATCH', json: body })
}

const PROJECT_PALETTE = [
  '#e2ab41','#f97316','#ef4444','#ec4899','#a855f7',
  '#6366f1','#3b82f6','#06b6d4','#10b981','#22c55e',
  '#84cc16','#eab308','#f59e0b','#64748b','#6b7280',
]

const STATUS_CONFIG = {
  active:    { label: 'Active',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   dot: '#22c55e' },
  paused:    { label: 'Paused',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  dot: '#f59e0b' },
  completed: { label: 'Completed', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', dot: '#6366f1' },
}

function ColorPickerTrigger({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {PROJECT_PALETTE.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          style={{ width: 24, height: 24, borderRadius: 6, background: c, border: 'none', cursor: 'pointer', flexShrink: 0,
            outline: value === c ? `3px solid ${c}` : '2px solid transparent', outlineOffset: 2,
            transform: value === c ? 'scale(1.18)' : 'scale(1)', transition: 'all 0.12s' }} title={c} />
      ))}
      <label style={{ position: 'relative', cursor: 'pointer' }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)', border: '2px solid var(--border)', display: 'grid', placeItems: 'center', fontSize: 13 }}>🎨</div>
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
      </label>
    </div>
  )
}

function InlineProjectName({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (name: string) => renameProject(project.id, name),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['projects'] }) },
    onError: () => { setEditing(false); setVal(project.name) },
  })
  function commit() {
    const t = val.trim()
    if (t.length >= 2 && t !== project.name) m.mutate(t)
    else setEditing(false)
  }
  if (editing) {
    return (
      <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setEditing(false); setVal(project.name) }
        }}
        onClick={e => e.stopPropagation()}
        style={{ fontSize: 15, fontWeight: 900, background: 'transparent', border: 'none', outline: '2px solid var(--brand)', borderRadius: 6, padding: '2px 6px', color: 'var(--text)', width: '100%' }}
      />
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {project.name}
      </span>
      {canEdit && (
        <button type="button" onClick={e => { e.stopPropagation(); setVal(project.name); setEditing(true); setTimeout(() => inputRef.current?.select(), 30) }}
          style={{ flexShrink: 0, width: 22, height: 22, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', borderRadius: 5, display: 'grid', placeItems: 'center', opacity: 0, transition: 'opacity 0.1s' }}
          className="projRenameBtn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function StatusBadge({ project, canEdit, onChangeRequest }: { project: Project; canEdit: boolean; onChangeRequest: (p: Project, s: 'active' | 'paused' | 'completed') => void }) {
  const value = (project.status || 'active') as 'active' | 'paused' | 'completed'
  const cfg = STATUS_CONFIG[value]

  if (!canEdit) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6,
        background: cfg.bg, border: `1px solid ${cfg.color}30`, fontSize: 11, fontWeight: 800, color: cfg.color }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
        {cfg.label}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px 3px 9px',
      borderRadius: 6, background: cfg.bg, border: `1px solid ${cfg.color}35`,
      fontSize: 11, fontWeight: 800, color: cfg.color }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      <select value={value}
        onChange={e => {
          const next = e.target.value as 'active' | 'paused' | 'completed'
          if (next !== value) onChangeRequest(project, next)
        }}
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="completed">Completed</option>
      </select>
      {cfg.label}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 2 }}><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  )
}

function ProjectCard({ p, canCreate, onClick, onChangeRequest }: { p: Project; canCreate: boolean; onClick: () => void; onChangeRequest: (p: Project, s: 'active'|'paused'|'completed') => void }) {
  const accent = p.color || '#e2ab41'
  const taskCount = Number(p.task_count || 0)

  return (
    <div className="projCard" onClick={onClick}
      style={{ '--proj-accent': accent } as React.CSSProperties}>
      <div style={{ height: 3, background: accent, margin: '-16px -16px 16px', borderRadius: '10px 10px 0 0', opacity: 0.85 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: accent + '18', border: `1.5px solid ${accent}30`,
          display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: accent }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineProjectName project={p} canEdit={canCreate} />
          {p.description ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.description}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--border)', marginTop: 3, fontStyle: 'italic' }}>No description</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: 'var(--text2)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </div>
        <StatusBadge project={p} canEdit={canCreate} onChangeRequest={onChangeRequest} />
      </div>
    </div>
  )
}

function ProjectRow({ p, canCreate, onClick, onChangeRequest }: { p: Project; canCreate: boolean; onClick: () => void; onChangeRequest: (p: Project, s: 'active'|'paused'|'completed') => void }) {
  const accent = p.color || '#e2ab41'
  const taskCount = Number(p.task_count || 0)

  return (
    <div className="projRow" onClick={onClick}
      style={{ '--proj-accent': accent } as React.CSSProperties}>
      <div style={{ width: 3, background: accent, borderRadius: '10px 0 0 10px', alignSelf: 'stretch', flexShrink: 0 }} />
      <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: accent + '18', border: `1.5px solid ${accent}30`,
        display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 13, height: 13, borderRadius: 3, background: accent }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineProjectName project={p} canEdit={canCreate} />
        {p.description && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.description}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        {taskCount}
      </div>
      <div onClick={e => e.stopPropagation()}>
        <StatusBadge project={p} canEdit={canCreate} onChangeRequest={onChangeRequest} />
      </div>
    </div>
  )
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, retry: 2, staleTime: 30_000, refetchInterval: 60_000 })
  const { success: toastSuccess, error: toastError } = useToast()
  useRealtimeInvalidation({ tasks: true })

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#e2ab41')
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try { const s = localStorage.getItem('tf_projects_view'); return s === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all')

  const [statusChangeTarget, setStatusChangeTarget] = useState<StatusChangeTarget | null>(null)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [loadingActiveTasks, setLoadingActiveTasks] = useState(false)

  const statusChangeMutation = useMutation({
    mutationFn: ({ id, name, status, opts }: { id: string; name?: string; status: 'active'|'paused'|'completed'; opts?: Parameters<typeof changeProjectStatus>[3] }) =>
      changeProjectStatus(id, status, name, opts),
    onSuccess: (data, variables) => {
      const updated = data?.project
      const canonicalId = data?.canonicalProjectId || updated?.id
      const requestedId = data?.requestedProjectId || variables.id
      const responseName = data?.requestedProjectName || updated?.name || variables.name
      const responseNameLower = responseName?.trim().toLowerCase()

      qc.setQueryData<Project[]>(['projects'], (old) => {
        if (!old?.length) return old
        return old.map((project) => {
          const matches =
            project.id === variables.id ||
            project.id === requestedId ||
            (canonicalId ? project.id === canonicalId : false) ||
            (responseNameLower ? project.name.trim().toLowerCase() === responseNameLower : false)
          if (!matches) return project
          return {
            ...project,
            ...(updated || {}),
            id: project.id,
            status: updated?.status || variables.status,
          }
        })
      })
      qc.invalidateQueries({ queryKey: ['projects'] })
      toastSuccess('Status updated', `Project is now ${variables.status}`)
      setStatusChangeTarget(null); setActiveTasks([])
    },
    onError: (err) => toastError('Update failed', err instanceof ApiError ? err.message : 'Could not update status'),
  })

  const handleStatusChangeRequest = useCallback(async (project: Project, targetStatus: 'active'|'paused'|'completed') => {
    if (targetStatus === 'active') {
      statusChangeMutation.mutate({ id: project.id, name: project.name, status: 'active' })
      return
    }
    setStatusChangeTarget({ project, targetStatus })
    setLoadingActiveTasks(true)
    try {
      const tasks = await fetchActiveTasks(project.id)
      setActiveTasks(tasks)
    } catch {
      setActiveTasks([])
    } finally {
      setLoadingActiveTasks(false)
    }
  }, [statusChangeMutation])

  function confirmStatusChange(force = false) {
    if (!statusChangeTarget) return
    const { project, targetStatus } = statusChangeTarget
    const opts: Parameters<typeof changeProjectStatus>[3] = {}
    if (targetStatus === 'paused' && force) opts.force = true
    statusChangeMutation.mutate({ id: project.id, name: project.name, status: targetStatus, opts })
  }

  const projects = useMemo(() => q.data || [], [q.data])
  const filtered = useMemo(() => {
    let list = projects
    if (statusFilter !== 'all') list = list.filter(p => (p.status || 'active') === statusFilter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(s) || p.description?.toLowerCase().includes(s))
    }
    return list
  }, [projects, statusFilter, search])

  const totalTasks = useMemo(() => projects.reduce((s, p) => s + Number(p.task_count || 0), 0), [projects])
  const activeCount = useMemo(() => projects.filter(p => (p.status || 'active') === 'active').length, [projects])
  const completedCount = useMemo(() => projects.filter(p => p.status === 'completed').length, [projects])

  const m = useMutation({
    mutationFn: createProject,
    onSuccess: async (data) => {
      setName(''); setDescription(''); setColor('#e2ab41'); setError(null); setCreateOpen(false)
      await qc.invalidateQueries({ queryKey: ['projects'] })
      toastSuccess('Project created', `"${data.project?.name || name}" is ready.`)
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to create project.'
      setError(msg); toastError('Create failed', msg)
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault(); setError(null)
    const n = name.trim()
    if (n.length < 2) { setError('Project name must be at least 2 characters.'); return }
    m.mutate({ name: n, description: description.trim() || undefined, color })
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <PageHeaderCard
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        }
        title="Projects"
        subtitle="Organize tasks by project. Track progress across your team."
        badges={[
          { label: `${projects.length} total` },
          { label: `${activeCount} active`, color: '#22c55e' },
          ...(completedCount > 0 ? [{ label: `${completedCount} completed`, color: '#6366f1' }] : []),
          { label: `${totalTasks} tasks` },
        ]}
        actions={
          canCreate ? (
            <button type="button" className="btn btnPrimary" onClick={() => setCreateOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Project
            </button>
          ) : undefined
        }
      />

      {q.isError && <div className="alertV4 alertV4Error">Failed to load projects. Please refresh the page.</div>}

      <KpiStrip
        items={[
          { label: 'Total Projects', value: projects.length, color: '#e2ab41', icon: <FolderOpen size={36} /> },
          { label: 'Active Projects', value: activeCount, color: '#22c55e', icon: <CircleDot size={36} /> },
          { label: 'Total Tasks', value: totalTasks, color: '#e2ab41', icon: <ListTodo size={36} /> },
        ]}
      />

      <PageLiveCharts title="Live project analytics" variant="compact" days={30} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 200px', position: 'relative', minWidth: 140 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…"
            style={{ width: '100%', height: 'var(--control-height, 40px)', paddingLeft: 32, paddingRight: 12, border: '1px solid var(--border)',
              borderRadius: 9, background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
          {(['all', 'active', 'paused', 'completed'] as const).map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              style={{ height: 30, padding: '0 12px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: statusFilter === s ? 'var(--brand)' : 'transparent',
                color: statusFilter === s ? '#1a1d2e' : 'var(--text2)',
                transition: 'all 0.12s' }}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}
          className="projViewToggle">
          <button type="button" onClick={() => { setViewMode('grid'); try { localStorage.setItem('tf_projects_view','grid') } catch {} }}
            title="Grid view"
            style={{ width: 32, height: 30, borderRadius: 7, border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
              background: viewMode === 'grid' ? 'var(--brand)' : 'transparent',
              color: viewMode === 'grid' ? '#1a1d2e' : 'var(--text2)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button type="button" onClick={() => { setViewMode('list'); try { localStorage.setItem('tf_projects_view','list') } catch {} }}
            title="List view"
            style={{ width: 32, height: 30, borderRadius: 7, border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
              background: viewMode === 'list' ? 'var(--brand)' : 'transparent',
              color: viewMode === 'list' ? '#1a1d2e' : 'var(--text2)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}><IconFolder size={14} /></div>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>
            {search || statusFilter !== 'all' ? 'No projects match' : 'No projects yet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
            {search || statusFilter !== 'all'
              ? 'Try clearing the search or filter'
              : canCreate ? 'Create your first project to start organizing tasks' : 'Projects with your assigned tasks will appear here.'}
          </div>
          {canCreate && !search && statusFilter === 'all' && (
            <button type="button" className="btn btnPrimary" onClick={() => setCreateOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create First Project
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="projGrid">
          {filtered.map(p => <ProjectCard key={p.id} p={p} canCreate={canCreate} onClick={() => setDetailId(p.id)} onChangeRequest={handleStatusChangeRequest} />)}
        </div>
      ) : (
        <div className="projList">
          {filtered.map(p => <ProjectRow key={p.id} p={p} canCreate={canCreate} onClick={() => setDetailId(p.id)} onChangeRequest={handleStatusChangeRequest} />)}
        </div>
      )}

      {filtered.length > 0 && (search || statusFilter !== 'all') && (
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>
          Showing {filtered.length} of {projects.length} projects
        </div>
      )}

      <Modal title="New Project" subtitle="Organize related tasks under a project" open={createOpen}
        onClose={() => { setCreateOpen(false); setError(null) }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btnGhost" onClick={() => { setCreateOpen(false); setError(null) }}>Cancel</button>
            <button type="submit" form="createProjectForm" className="btn btnPrimary" disabled={m.isPending}>
              {m.isPending ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        }>
        {error && <div className="alertV4 alertV4Error" style={{ marginBottom: 14 }}>{error}</div>}
        <form id="createProjectForm" onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
          <Input label="Project Name" required placeholder="e.g. Onboarding, Payroll, Q4 Sprint" value={name}
            onChange={e => setName(e.target.value)} autoFocus
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
          />
          <div className="inputV3Wrap">
            <label className="selectV3Label">Description <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <div className="inputV3Field textareaField" style={{ height: 'auto' }}>
              <textarea className="inputV3Native" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of this project…" style={{ height: 72, paddingTop: 10, paddingBottom: 10, resize: 'vertical' }} />
            </div>
          </div>
          <div className="inputV3Wrap">
            <label className="selectV3Label">Accent Color</label>
            <ColorPickerTrigger value={color} onChange={setColor} />
          </div>
        </form>
      </Modal>

      <ProjectDetailModal projectId={detailId} onClose={() => setDetailId(null)}
        onOpenTasks={() => { setDetailId(null); navigate('/app/tasks') }} />

      {statusChangeTarget && (
        <div className="modalOverlayV2" onMouseDown={() => { if (!statusChangeMutation.isPending) { setStatusChangeTarget(null); setActiveTasks([]) } }}>
          <div className="modalCardV2" style={{ maxWidth: 500 }} onMouseDown={e => e.stopPropagation()}>
            <div className="modalV2Head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: statusChangeTarget.targetStatus === 'completed' ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.12)',
                  border: `1px solid ${statusChangeTarget.targetStatus === 'completed' ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  color: statusChangeTarget.targetStatus === 'completed' ? '#818cf8' : '#f59e0b' }}>
                  {statusChangeTarget.targetStatus === 'completed'
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  }
                </div>
                <div>
                  <div className="modalV2Title">
                    {statusChangeTarget.targetStatus === 'completed' ? 'Complete Project?' : 'Pause Project?'}
                  </div>
                  <div className="modalV2Sub" style={{ fontWeight: 700 }}>"{statusChangeTarget.project.name}"</div>
                </div>
              </div>
              <button className="modalV2Close" onClick={() => { setStatusChangeTarget(null); setActiveTasks([]) }}
                type="button" disabled={statusChangeMutation.isPending}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modalV2Body">
              {loadingActiveTasks ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Checking active tasks…</div>
              ) : activeTasks.length > 0 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 14 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>
                      {activeTasks.length} active task{activeTasks.length > 1 ? 's' : ''} still in progress
                    </span>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {activeTasks.map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 9, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                          background: t.status === 'in_progress' ? '#8b5cf6' : t.status === 'submitted' ? '#38bdf8' : '#f59e0b' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                            {t.status.replace(/_/g, ' ')}
                            {t.assignee_name ? ` · ${t.assignee_name}` : ''}
                            {t.due_date ? ` · Due ${new Date(t.due_date).toLocaleDateString()}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {statusChangeTarget.targetStatus === 'paused' && (
                    <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                      Pausing this project will <strong>halt all active tasks</strong>. Team members won't lose progress but won't be able to submit until the project is resumed.
                    </p>
                  )}
                  {statusChangeTarget.targetStatus === 'completed' && (
                    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 900, marginBottom: 4 }}>Action required</div>
                      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                        Complete or cancel all tasks in this project first. After every task is completed or cancelled, you can mark the project as completed.
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  {statusChangeTarget.targetStatus === 'completed'
                    ? 'All project tasks are completed or cancelled. You can mark this project as completed.'
                    : 'No active tasks found. You can safely pause this project.'}
                </p>
              )}
            </div>
            <div className="modalV2Foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btnGhost" onClick={() => { setStatusChangeTarget(null); setActiveTasks([]) }}
                disabled={statusChangeMutation.isPending}>Cancel</button>

              {activeTasks.length === 0 && (
                <button type="button" className="btn btnPrimary" disabled={statusChangeMutation.isPending}
                  onClick={() => confirmStatusChange(false)}>
                  {statusChangeMutation.isPending ? 'Updating…' : `Mark as ${statusChangeTarget.targetStatus}`}
                </button>
              )}

              {activeTasks.length > 0 && statusChangeTarget.targetStatus === 'paused' && (
                <button type="button" className="btn btnPrimary" disabled={statusChangeMutation.isPending}
                  style={{ background: '#f59e0b', color: '#1a1d2e' }}
                  onClick={() => confirmStatusChange(true)}>
                  {statusChangeMutation.isPending ? 'Pausing…' : 'Pause Anyway'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
