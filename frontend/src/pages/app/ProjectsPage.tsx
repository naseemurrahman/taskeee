import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker'
import { ProjectDetailModal } from '../../components/projects/ProjectDetailModal'

type Project = {
  id: string
  name: string
  description?: string | null
  color?: string | null
}

async function fetchProjects() {
  const data = await apiFetch<{ projects: Project[] }>(`/api/v1/projects`)
  return data.projects || []
}

async function createProject(input: { name: string; description?: string; color?: string }) {
  return await apiFetch<{ project: Project }>(`/api/v1/projects`, { method: 'POST', json: input })
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const me = getUser()
  const canCreate = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['projects'], queryFn: fetchProjects })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#f4ca57')
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const projects = useMemo(() => q.data || [], [q.data])

  const m = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setName('')
      setDescription('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create project.')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const n = name.trim()
    if (n.length < 2) {
      setError('Project name must be at least 2 characters.')
      return
    }
    m.mutate({ name: n, description: description.trim() || undefined, color: color.trim() || undefined })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Projects</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Organize work by project (task category).</div>
          </div>
        </div>

        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load projects.</div> : null}

        {!canCreate ? (
          <div style={{ marginTop: 12, color: 'var(--text2)' }}>Only managers, HR, directors, and admins can create organization projects.</div>
        ) : (
          <form onSubmit={onSubmit} className="form formProjectsCreate" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Project name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onboarding, Payroll, Sales Ops" />
            </label>
            <div className="label" style={{ gridColumn: '1 / -1', margin: 0 }}>
              <span id="project-accent-label">Accent color</span>
              <ColorSwatchPicker value={color} onChange={setColor} labelId="project-accent-label" />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-start' }}>
              <button className="btn btnPrimary" type="submit" disabled={m.isPending} style={{ width: 'fit-content', minWidth: 'auto' }}>
                {m.isPending ? 'Creating…' : 'Create project'}
              </button>
            </div>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Description (optional)
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
            </label>
          </form>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Your projects</h3>
        <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 10 }}>Select a project for deadlines, people, scores, and threads.</div>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!q.isLoading && projects.length === 0 ? (
          <div style={{ color: 'var(--text2)' }}>No projects yet. Create one above.</div>
        ) : null}
        <div className="projectGrid">
          {projects.map((p) => (
            <button key={p.id} type="button" className="projectCard" onClick={() => setDetailId(p.id)}>
              <div className="projectDot" style={{ background: p.color || 'rgba(244,202,87,0.9)' }} />
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div className="projectName">{p.name}</div>
                <div className="projectDesc">{p.description || '—'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <ProjectDetailModal
        projectId={detailId}
        onClose={() => setDetailId(null)}
        onOpenTasks={() => {
          setDetailId(null)
          navigate('/app/tasks')
        }}
      />
    </div>
  )
}
