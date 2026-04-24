import { useMemo, useState, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { ProjectDetailModal } from '../../components/projects/ProjectDetailModal'
import { Modal } from '../../components/Modal'
import { Input } from '../../components/ui/Input'

type Project = { id: string; name: string; description?: string | null; color?: string | null; status?: 'active' | 'paused' | 'completed' }

async function fetchProjects() {
  const d = await apiFetch<{ projects: Project[] }>('/api/v1/projects')
  return d.projects || []
}
async function createProject(input: { name: string; description?: string; color?: string }) {
  return await apiFetch<{ project: Project }>('/api/v1/projects', { method: 'POST', json: input })
}
async function renameProject(id: string, name: string) {
  return apiFetch(`/api/v1/projects/${id}`, { method: 'PATCH', json: { name } })
}
async function changeProjectStatus(id: string, status: 'active' | 'paused' | 'completed') {
  return apiFetch(`/api/v1/projects/${id}`, { method: 'PATCH', json: { status } })
}

const PROJECT_PALETTE = [
  '#e2ab41','#f97316','#ef4444','#ec4899','#a855f7',
  '#6366f1','#3b82f6','#06b6d4','#10b981','#22c55e',
  '#84cc16','#eab308','#f59e0b','#64748b','#6b7280',
]

function ColorPickerTrigger({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {PROJECT_PALETTE.map(c => (
        <button
          key={c} type="button"
          onClick={() => onChange(c)}
          style={{
            width: 26, height: 26, borderRadius: 7, background: c, border: 'none',
            cursor: 'pointer', flexShrink: 0,
            outline: value === c ? `3px solid ${c}` : '2px solid transparent',
            outlineOffset: 2,
            transition: 'outline 0.1s, transform 0.1s',
            transform: value === c ? 'scale(1.2)' : 'scale(1)',
          }}
          title={c}
        />
      ))}
      {/* Custom color */}
      <label style={{ position: 'relative', cursor: 'pointer' }} title="Custom color">
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)`,
          border: '2px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>🎨</div>
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
        />
      </label>
    </div>
  )
}

/** Inline rename for project cards */
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

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setVal(project.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 30)
  }

  function commit() {
    const t = val.trim()
    if (t.length >= 2 && t !== project.name) m.mutate(t)
    else setEditing(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') { setEditing(false); setVal(project.name) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="inlineEditInput"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onClick={e => e.stopPropagation()}
        style={{ fontSize: 13 }}
      />
    )
  }

  return (
    <div className="inlineEditWrap" style={{ maxWidth: '100%' }}>
      <span style={{ fontWeight: 900, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--text)' }}>{project.name}</span>
      {canEdit && (
        <button className="inlineEditBtn" type="button" onClick={startEdit} title="Rename project">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function InlineProjectStatus({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (status: 'active' | 'paused' | 'completed') => changeProjectStatus(project.id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
  const value = project.status || 'active'
  if (!canEdit) {
    return <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{value}</span>
  }
  return (
    <select
      value={value}
      onChange={e => m.mutate(e.target.value as 'active' | 'paused' | 'completed')}
      disabled={m.isPending}
      onClick={e => e.stopPropagation()}
      style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg1)', color: 'var(--text2)', fontSize: 11, padding: '3px 6px' }}
    >
      <option value="active">Active</option>
      <option value="paused">Paused</option>
      <option value="completed">Completed</option>
    </select>
  )
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, retry: 2 })

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#e2ab41')
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const projects = useMemo(() => q.data || [], [q.data])

  const m = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setName(''); setDescription(''); setColor('#e2ab41'); setError(null)
      setCreateOpen(false)
      await qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create project.'),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault(); setError(null)
    const n = name.trim()
    if (n.length < 2) { setError('Project name must be at least 2 characters.'); return }
    m.mutate({ name: n, description: description.trim() || undefined, color })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>

      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Projects
            </div>
            <div className="pageHeaderCardSub">
              Organize tasks by project — each project is a category that groups related work.
              Assign tasks to projects, track progress, and view analytics per project.
            </div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </span>
              {canCreate && (
                <span className="pageHeaderCardTag">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Can create projects
                </span>
              )}
            </div>
          </div>
          {canCreate && (
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => setCreateOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Project
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {q.isError && (
        <div className="alertV4 alertV4Error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Failed to load projects. Please refresh the page.
        </div>
      )}

      {/* Projects grid */}
      <div className="chartV3">
        <div className="chartV3Head" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
          <div>
            <div className="chartV3Title">Your Projects</div>
            <div className="chartV3Sub">Select a project for deadlines, people, scores, and threads</div>
          </div>
        </div>
        <div style={{ padding: '16px' }}>
          {q.isLoading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading projects…</div>
          )}
          {!q.isLoading && projects.length === 0 && (
            <div className="emptyStateV3" style={{ padding: '40px 20px' }}>
              <div className="emptyStateV3Icon">📁</div>
              <div className="emptyStateV3Title">No projects yet</div>
              <div className="emptyStateV3Body">Create your first project to start organizing tasks</div>
              {canCreate && (
                <button className="btn btnPrimary" onClick={() => setCreateOpen(true)} style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7 }} type="button">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create First Project
                </button>
              )}
            </div>
          )}
          {projects.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {projects.map(p => (
                <button
                  key={p.id} type="button"
                  onClick={() => setDetailId(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 16px', borderRadius: 14,
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.14s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = p.color || 'rgba(226,171,65,0.4)'; e.currentTarget.style.boxShadow = `0 4px 16px ${(p.color || '#e2ab41')}20` }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                    background: (p.color || '#e2ab41') + '20',
                    border: `1.5px solid ${(p.color || '#e2ab41')}40`,
                    display: 'grid', placeItems: 'center',
                  }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: p.color || '#e2ab41' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <InlineProjectName project={p} canEdit={canCreate} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || 'No description'}</div>
                      <InlineProjectStatus project={p} canEdit={canCreate} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Create Project Modal ── */}
      <Modal
        title="New Project"
        subtitle="Organize related tasks under a project"
        open={createOpen}
        onClose={() => { setCreateOpen(false); setError(null) }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btnGhost" onClick={() => { setCreateOpen(false); setError(null) }}>Cancel</button>
            <button type="submit" form="createProjectForm" className="btn btnPrimary" disabled={m.isPending}>
              {m.isPending ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        }
      >
        {error && (
          <div className="alertV4 alertV4Error" style={{ marginBottom: 14 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}
        <form id="createProjectForm" onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
          <Input
            label="Project Name" required
            placeholder="e.g. Onboarding, Payroll, Sales Ops"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
          />
          <div className="inputV3Wrap">
            <label className="selectV3Label">Description <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <div className="inputV3Field textareaField" style={{ height: 'auto' }}>
              <textarea
                className="inputV3Native"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of this project…"
                style={{ height: 72, paddingTop: 10, paddingBottom: 10, resize: 'vertical' }}
              />
            </div>
          </div>
          {/* Color picker BELOW description */}
          <div className="inputV3Wrap">
            <label className="selectV3Label">Accent Color</label>
            <ColorPickerTrigger value={color} onChange={setColor} />
          </div>
        </form>
      </Modal>

      <ProjectDetailModal
        projectId={detailId}
        onClose={() => setDetailId(null)}
        onOpenTasks={() => { setDetailId(null); navigate('/app/tasks') }}
      />
    </div>
  )
}
