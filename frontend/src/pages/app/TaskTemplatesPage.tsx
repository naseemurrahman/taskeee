import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { useToast } from '../../components/ui/ToastSystem'
import { Select } from '../../components/ui/Select'

type Template = {
  id: string
  name: string
  description?: string | null
  task_title: string
  task_description?: string | null
  priority: string
  category_id?: string | null
  default_due_days?: number | null
  checklist_items: Array<{ title: string; order?: number }>
  created_by_name?: string | null
  updated_at?: string
}

type UserRow = { id: string; email: string; full_name?: string | null; name?: string | null; role: string; department?: string | null }
type Project = { id: string; name: string; color?: string | null }

const PRIORITIES = ['low', 'medium', 'high', 'critical']

async function fetchTemplates() { return apiFetch<{ templates: Template[] }>('/api/v1/task-templates') }
async function fetchUsers() { try { return await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users') } catch { return { users: [] } } }
async function fetchProjects() { try { return await apiFetch<{ projects: Project[] }>('/api/v1/projects') } catch { return { projects: [] } } }

function emptyForm() {
  return { name: '', description: '', taskTitle: '', taskDescription: '', priority: 'medium', categoryId: '', defaultDueDays: '3', checklistText: '' }
}

function parseChecklist(text: string) {
  return text.split('\n').map((x, i) => ({ title: x.trim(), order: i + 1 })).filter(x => x.title)
}

function checklistToText(items: Template['checklist_items']) {
  return (items || []).map(x => x.title).join('\n')
}

function priorityTone(priority: string) {
  if (priority === 'critical') return '#ef4444'
  if (priority === 'high') return '#f97316'
  if (priority === 'low') return '#38bdf8'
  return 'var(--brand)'
}

export function TaskTemplatesPage() {
  const me = getUser()
  const canManage = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const { success, error } = useToast()
  const [form, setForm] = useState(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [assignee, setAssignee] = useState('')
  const [createOverride, setCreateOverride] = useState({ title: '', dueDate: '', priority: '' })
  const [query, setQuery] = useState('')

  const templatesQ = useQuery({ queryKey: ['task-templates'], queryFn: fetchTemplates })
  const usersQ = useQuery({ queryKey: ['template-assignable-users'], queryFn: fetchUsers, enabled: canManage })
  const projectsQ = useQuery({ queryKey: ['template-projects'], queryFn: fetchProjects, enabled: canManage })
  const templates = templatesQ.data?.templates || []
  const users = usersQ.data?.users || []
  const projects = projectsQ.data?.projects || []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t => [t.name, t.description, t.task_title, t.task_description, t.priority].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [templates, query])

  const saveM = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(), description: form.description.trim(), taskTitle: form.taskTitle.trim(), taskDescription: form.taskDescription.trim(),
        priority: form.priority, categoryId: form.categoryId || null, defaultDueDays: form.defaultDueDays ? Number(form.defaultDueDays) : null,
        checklistItems: parseChecklist(form.checklistText),
      }
      if (editingId) return apiFetch(`/api/v1/task-templates/${editingId}`, { method: 'PATCH', json: body })
      return apiFetch('/api/v1/task-templates', { method: 'POST', json: body })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task-templates'] }); setForm(emptyForm()); setEditingId(null); success('Template saved', 'Task template is ready.') },
    onError: (e: any) => error('Save failed', e?.message || 'Could not save template.'),
  })

  const deleteM = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/task-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task-templates'] }); success('Template deleted', 'The template was removed.') },
    onError: (e: any) => error('Delete failed', e?.message || 'Could not delete template.'),
  })

  const createTaskM = useMutation({
    mutationFn: () => apiFetch(`/api/v1/task-templates/${selectedTemplate?.id}/create-task`, { method: 'POST', json: { assignedTo: assignee, title: createOverride.title || undefined, dueDate: createOverride.dueDate || undefined, priority: createOverride.priority || undefined } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setSelectedTemplate(null); setAssignee(''); setCreateOverride({ title: '', dueDate: '', priority: '' }); success('Task created', 'Task and checklist subtasks were created from the template.') },
    onError: (e: any) => error('Create failed', e?.message || 'Could not create task from template.'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.taskTitle.trim()) { error('Missing fields', 'Template name and task title are required.'); return }
    saveM.mutate()
  }

  function edit(t: Template) {
    setEditingId(t.id)
    setForm({ name: t.name || '', description: t.description || '', taskTitle: t.task_title || '', taskDescription: t.task_description || '', priority: t.priority || 'medium', categoryId: t.category_id || '', defaultDueDays: t.default_due_days == null ? '' : String(t.default_due_days), checklistText: checklistToText(t.checklist_items) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!canManage) return <div className="qaEmptyState"><div className="qaEmptyStateIcon">Lock</div><div className="qaEmptyStateTitle">Task templates require manager access</div><div className="qaEmptyStateBody">Supervisors, managers, HR, directors, and admins can manage reusable task templates.</div></div>

  return <div style={{ display: 'grid', gap: 18 }}>
    <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Task Templates</div><div className="pageHeaderCardSub">Create reusable task templates with checklist/subtask templates. Apply them to generate a task and checklist items in one step.</div><div className="pageHeaderCardMeta"><span className="pageHeaderCardTag">{templates.length} templates</span><span className="pageHeaderCardTag">Checklist-enabled</span></div></div></div></div>

    <div className="templateGrid">
      <form onSubmit={submit} className="templatePanel">
        <div className="templatePanelHead"><div><div className="templatePanelTitle">{editingId ? 'Edit template' : 'New template'}</div><div className="templatePanelSub">Define default task details and checklist items.</div></div>{editingId ? <button type="button" className="btn btnGhost" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>Cancel edit</button> : null}</div>
        <div className="templateFormGrid">
          <label>Template name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Employee onboarding" /></label>
          <label>Priority<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
          <label>Project<select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}><option value="">No default project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Default due days<input type="number" min="0" max="365" value={form.defaultDueDays} onChange={e => setForm({ ...form, defaultDueDays: e.target.value })} /></label>
        </div>
        <label>Description<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Internal template description" /></label>
        <label>Task title<input value={form.taskTitle} onChange={e => setForm({ ...form, taskTitle: e.target.value })} placeholder="Task title to create" /></label>
        <label>Task description<textarea value={form.taskDescription} onChange={e => setForm({ ...form, taskDescription: e.target.value })} placeholder="Default task instructions" /></label>
        <label>Checklist/subtask template<textarea value={form.checklistText} onChange={e => setForm({ ...form, checklistText: e.target.value })} placeholder={'One checklist item per line\nCollect documents\nVerify details\nManager approval'} /></label>
        <button className="btn btnPrimary" type="submit" disabled={saveM.isPending}>{saveM.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}</button>
      </form>

      <div className="templatePanel">
        <div className="templatePanelHead"><div><div className="templatePanelTitle">Template library</div><div className="templatePanelSub">Search, edit, or apply a template.</div></div></div>
        <input className="templateSearch" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates…" />
        {templatesQ.isLoading ? <div className="projectListSkeleton"><div className="projectListSkeletonRow" /><div className="projectListSkeletonRow" /></div> : null}
        {!templatesQ.isLoading && filtered.length === 0 ? <div className="qaEmptyState"><div className="qaEmptyStateIcon">□</div><div className="qaEmptyStateTitle">No templates found</div><div className="qaEmptyStateBody">Create a template to speed up repeated operational tasks.</div></div> : null}
        <div className="templateList">
          {filtered.map(t => <div key={t.id} className="templateCard">
            <div className="templateCardTop"><div><div className="templateCardTitle">{t.name}</div><div className="templateCardSub">{t.task_title}</div></div><span style={{ color: priorityTone(t.priority) }} className="templatePriority">{t.priority}</span></div>
            {t.description ? <div className="templateCardBody">{t.description}</div> : null}
            <div className="templateStats"><span>{t.checklist_items?.length || 0} checklist items</span>{t.default_due_days != null ? <span>{t.default_due_days} due days</span> : null}{t.created_by_name ? <span>By {t.created_by_name}</span> : null}</div>
            <div className="templateActions"><button className="btn btnPrimary" type="button" onClick={() => { setSelectedTemplate(t); setCreateOverride({ title: t.task_title, dueDate: '', priority: t.priority }) }}>Use</button><button className="btn btnGhost" type="button" onClick={() => edit(t)}>Edit</button><button className="btn btnGhost" type="button" onClick={() => deleteM.mutate(t.id)} disabled={deleteM.isPending}>Delete</button></div>
          </div>)}
        </div>
      </div>
    </div>

    {selectedTemplate ? <div className="templateDrawerBackdrop" onClick={() => setSelectedTemplate(null)}><div className="templateDrawer" onClick={e => e.stopPropagation()}><div className="templatePanelHead"><div><div className="templatePanelTitle">Create task from template</div><div className="templatePanelSub">{selectedTemplate.name}</div></div><button className="btn btnGhost" onClick={() => setSelectedTemplate(null)}>Close</button></div><div className="templateFormGrid"><label>Assignee<Select value={assignee} onChange={setAssignee} searchable options={[{ value: '', label: usersQ.isLoading ? 'Loading…' : 'Select employee', disabled: true }, ...users.map(u => ({ value: u.id, label: u.full_name || u.name || u.email, description: [u.department, u.role].filter(Boolean).join(' · ') }))]} /></label><label>Priority<select value={createOverride.priority} onChange={e => setCreateOverride({ ...createOverride, priority: e.target.value })}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select></label></div><label>Task title<input value={createOverride.title} onChange={e => setCreateOverride({ ...createOverride, title: e.target.value })} /></label><label>Due date<input type="date" value={createOverride.dueDate} onChange={e => setCreateOverride({ ...createOverride, dueDate: e.target.value })} /></label><div className="templateChecklistPreview"><strong>Checklist items</strong>{(selectedTemplate.checklist_items || []).map(x => <div key={x.title}>✓ {x.title}</div>)}</div><button className="btn btnPrimary" disabled={!assignee || createTaskM.isPending} onClick={() => createTaskM.mutate()}>{createTaskM.isPending ? 'Creating…' : 'Create task + checklist'}</button></div></div> : null}
  </div>
}
