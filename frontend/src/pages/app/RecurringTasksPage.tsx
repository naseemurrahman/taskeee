import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects } from '../../lib/rbac'
import { useToast } from '../../components/ui/ToastSystem'
import { Select } from '../../components/ui/Select'

type Template = { id: string; name: string; task_title: string; priority: string; checklist_items?: Array<{ title: string }> }
type UserRow = { id: string; email: string; full_name?: string | null; name?: string | null; role: string; department?: string | null }
type Rule = { id: string; name: string; template_id: string; template_name?: string | null; task_title?: string | null; assigned_to: string; assignee_name?: string | null; assignee_email?: string | null; frequency: string; interval_count: number; start_date: string; next_run_at: string; end_date?: string | null; is_active: boolean; generated_count: number; last_generated_at?: string | null }

async function fetchTemplates() { return apiFetch<{ templates: Template[] }>('/api/v1/task-templates') }
async function fetchUsers() { try { return await apiFetch<{ users: UserRow[] }>('/api/v1/tasks/assignable-users') } catch { return { users: [] } } }
async function fetchRules() { return apiFetch<{ rules: Rule[] }>('/api/v1/recurring-tasks') }

function today() { return new Date().toISOString().slice(0, 10) }
function fmtDate(v?: string | null) { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString() }
function cadenceLabel(rule: Rule) { const n = Number(rule.interval_count || 1); const f = rule.frequency; if (n === 1) return f === 'daily' ? 'Daily' : f === 'monthly' ? 'Monthly' : 'Weekly'; return `Every ${n} ${f === 'daily' ? 'days' : f === 'monthly' ? 'months' : 'weeks'}` }

export function RecurringTasksPage() {
  const me = getUser()
  const canManage = canCreateTasksAndProjects(me?.role)
  const qc = useQueryClient()
  const { success, error } = useToast()
  const [form, setForm] = useState({ name: '', templateId: '', assignedTo: '', frequency: 'weekly', intervalCount: '1', startDate: today(), endDate: '' })
  const [query, setQuery] = useState('')

  const rulesQ = useQuery({ queryKey: ['recurring-task-rules'], queryFn: fetchRules })
  const templatesQ = useQuery({ queryKey: ['task-templates'], queryFn: fetchTemplates, enabled: canManage })
  const usersQ = useQuery({ queryKey: ['recurring-assignable-users'], queryFn: fetchUsers, enabled: canManage })
  const rules = rulesQ.data?.rules || []
  const templates = templatesQ.data?.templates || []
  const users = usersQ.data?.users || []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rules
    return rules.filter(r => [r.name, r.template_name, r.task_title, r.assignee_name, r.assignee_email, r.frequency].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [rules, query])

  const activeCount = rules.filter(r => r.is_active).length
  const generatedTotal = rules.reduce((sum, r) => sum + Number(r.generated_count || 0), 0)

  const createM = useMutation({
    mutationFn: () => apiFetch('/api/v1/recurring-tasks', { method: 'POST', json: { name: form.name.trim(), templateId: form.templateId, assignedTo: form.assignedTo, frequency: form.frequency, intervalCount: Number(form.intervalCount || 1), startDate: form.startDate, endDate: form.endDate || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring-task-rules'] }); setForm({ name: '', templateId: '', assignedTo: '', frequency: 'weekly', intervalCount: '1', startDate: today(), endDate: '' }); success('Recurring rule created', 'Future tasks will be generated from this schedule.') },
    onError: (e: any) => error('Create failed', e?.message || 'Could not create recurring rule.'),
  })

  const toggleM = useMutation({
    mutationFn: (r: Rule) => apiFetch(`/api/v1/recurring-tasks/${r.id}`, { method: 'PATCH', json: { isActive: !r.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-task-rules'] }),
    onError: (e: any) => error('Update failed', e?.message || 'Could not update recurring rule.'),
  })

  const deleteM = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/recurring-tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring-task-rules'] }); success('Recurring rule deleted', 'The schedule was removed.') },
    onError: (e: any) => error('Delete failed', e?.message || 'Could not delete recurring rule.'),
  })

  const generateM = useMutation({
    mutationFn: (ruleId?: string) => apiFetch('/api/v1/recurring-tasks/generate-due', { method: 'POST', json: ruleId ? { ruleId } : {} }),
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ['recurring-task-rules'] }); qc.invalidateQueries({ queryKey: ['tasks'] }); success('Generation complete', `${d?.count || 0} due recurring task(s) generated.`) },
    onError: (e: any) => error('Generation failed', e?.message || 'Could not generate due recurring tasks.'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.templateId || !form.assignedTo) { error('Missing fields', 'Template and assignee are required.'); return }
    createM.mutate()
  }

  if (!canManage) return <div className="qaEmptyState"><div className="qaEmptyStateIcon">Lock</div><div className="qaEmptyStateTitle">Recurring tasks require manager access</div><div className="qaEmptyStateBody">Supervisors, managers, HR, directors, and admins can manage recurring task schedules.</div></div>

  return <div style={{ display: 'grid', gap: 18 }}>
    <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Recurring Tasks</div><div className="pageHeaderCardSub">Schedule rules that generate tasks from templates on daily, weekly, or monthly cadence.</div><div className="pageHeaderCardMeta"><span className="pageHeaderCardTag">{rules.length} rules</span><span className="pageHeaderCardTag">{activeCount} active</span><span className="pageHeaderCardTag">{generatedTotal} generated</span></div></div><button className="btn btnPrimary" onClick={() => generateM.mutate(undefined)} disabled={generateM.isPending}>{generateM.isPending ? 'Generating…' : 'Generate due now'}</button></div></div>

    <div className="recurringGrid">
      <form className="recurringPanel" onSubmit={submit}>
        <div className="recurringPanelHead"><div><div className="recurringPanelTitle">New schedule rule</div><div className="recurringPanelSub">Choose a template, assignee, and cadence.</div></div></div>
        <label>Rule name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Optional; defaults to template name" /></label>
        <label>Template<Select value={form.templateId} onChange={v => { const t = templates.find(x => x.id === v); setForm({ ...form, templateId: v, name: form.name || t?.name || '' }) }} searchable options={[{ value: '', label: templatesQ.isLoading ? 'Loading templates…' : 'Select template', disabled: true }, ...templates.map(t => ({ value: t.id, label: t.name, description: `${t.task_title} · ${t.checklist_items?.length || 0} checklist items` }))]} /></label>
        <label>Assignee<Select value={form.assignedTo} onChange={v => setForm({ ...form, assignedTo: v })} searchable options={[{ value: '', label: usersQ.isLoading ? 'Loading employees…' : 'Select assignee', disabled: true }, ...users.map(u => ({ value: u.id, label: u.full_name || u.name || u.email, description: [u.department, u.role].filter(Boolean).join(' · ') }))]} /></label>
        <div className="recurringFormGrid"><label>Frequency<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Every<input type="number" min="1" max="24" value={form.intervalCount} onChange={e => setForm({ ...form, intervalCount: e.target.value })} /></label></div>
        <div className="recurringFormGrid"><label>Start date<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label><label>End date<input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></label></div>
        <button className="btn btnPrimary" type="submit" disabled={createM.isPending}>{createM.isPending ? 'Creating…' : 'Create recurring rule'}</button>
      </form>

      <div className="recurringPanel">
        <div className="recurringPanelHead"><div><div className="recurringPanelTitle">Schedule library</div><div className="recurringPanelSub">Pause, resume, delete, or generate due tasks.</div></div></div>
        <input className="recurringSearch" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recurring rules…" />
        {rulesQ.isLoading ? <div className="projectListSkeleton"><div className="projectListSkeletonRow" /><div className="projectListSkeletonRow" /></div> : null}
        {!rulesQ.isLoading && filtered.length === 0 ? <div className="qaEmptyState"><div className="qaEmptyStateIcon">↻</div><div className="qaEmptyStateTitle">No recurring rules found</div><div className="qaEmptyStateBody">Create a schedule rule to automate repeated work.</div></div> : null}
        <div className="recurringList">
          {filtered.map(r => <div className={`recurringCard ${r.is_active ? '' : 'recurringCardPaused'}`} key={r.id}>
            <div className="recurringCardTop"><div><div className="recurringCardTitle">{r.name}</div><div className="recurringCardSub">{r.template_name || r.task_title || 'Template'} → {r.assignee_name || r.assignee_email || 'Assignee'}</div></div><span className="recurringStatus">{r.is_active ? 'Active' : 'Paused'}</span></div>
            <div className="recurringStats"><span>{cadenceLabel(r)}</span><span>Next: {fmtDate(r.next_run_at)}</span><span>Generated: {r.generated_count || 0}</span>{r.end_date ? <span>Ends: {fmtDate(r.end_date)}</span> : null}</div>
            <div className="recurringActions"><button className="btn btnGhost" onClick={() => toggleM.mutate(r)} disabled={toggleM.isPending}>{r.is_active ? 'Pause' : 'Resume'}</button><button className="btn btnPrimary" onClick={() => generateM.mutate(r.id)} disabled={generateM.isPending}>Generate if due</button><button className="btn btnGhost" onClick={() => deleteM.mutate(r.id)} disabled={deleteM.isPending}>Delete</button></div>
          </div>)}
        </div>
      </div>
    </div>
  </div>
}
