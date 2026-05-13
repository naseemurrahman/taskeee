import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getApiErrorMessage } from '../../lib/api'
import { getUser } from '../../state/auth'

type TimeEntry = {
  id: string
  task_id?: string | null
  task_title?: string | null
  started_at: string
  stopped_at?: string | null
  notes?: string | null
  source?: string
  duration_seconds?: number
}

type TimeEntriesResponse = { entries: TimeEntry[]; page: number; limit: number; total: number }
type SummaryUser = { user_id: string; user_name: string; entry_count: number; total_seconds: number | null; task_count: number }

function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Number(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function canSeeTeam(role?: string) {
  return ['supervisor', 'manager', 'hr', 'director', 'admin'].includes(String(role || '').toLowerCase())
}

export function TimeTrackingPage() {
  const queryClient = useQueryClient()
  const me = getUser()
  const [taskId, setTaskId] = useState('')
  const [notes, setNotes] = useState('')
  const [entryForm, setEntryForm] = useState({ taskId: '', startedAt: '', stoppedAt: '', notes: '' })
  const [error, setError] = useState('')

  const entriesQ = useQuery({
    queryKey: ['time-tracking', 'entries'],
    queryFn: () => apiFetch<TimeEntriesResponse>('/api/v1/time-tracking?limit=50'),
    refetchInterval: 60_000,
  })

  const summaryQ = useQuery({
    queryKey: ['time-tracking', 'summary'],
    queryFn: () => apiFetch<{ users: SummaryUser[]; days: number }>('/api/v1/time-tracking/summary?days=30'),
    enabled: canSeeTeam(me?.role),
  })

  const running = useMemo(() => entriesQ.data?.entries?.find(e => !e.stopped_at) || null, [entriesQ.data])
  const totalSeconds = useMemo(() => entriesQ.data?.entries?.reduce((sum, e) => sum + Number(e.duration_seconds || 0), 0) || 0, [entriesQ.data])

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['time-tracking'] })
  }

  const startTimer = useMutation({
    mutationFn: () => apiFetch('/api/v1/time-tracking/start', { method: 'POST', json: { taskId: taskId.trim() || null, notes: notes.trim() || null } }),
    onSuccess: async () => { setTaskId(''); setNotes(''); setError(''); await refresh() },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not start time tracking')),
  })

  const stopTimer = useMutation({
    mutationFn: () => apiFetch('/api/v1/time-tracking/stop', { method: 'POST', json: { entryId: running?.id, notes: notes.trim() || null } }),
    onSuccess: async () => { setNotes(''); setError(''); await refresh() },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not stop time tracking')),
  })

  const saveEntry = useMutation({
    mutationFn: () => apiFetch('/api/v1/time-tracking', {
      method: 'POST',
      json: { taskId: entryForm.taskId.trim() || null, startedAt: entryForm.startedAt, stoppedAt: entryForm.stoppedAt, notes: entryForm.notes.trim() || null },
    }),
    onSuccess: async () => { setEntryForm({ taskId: '', startedAt: '', stoppedAt: '', notes: '' }); setError(''); await refresh() },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not save time entry')),
  })

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Time Tracking</div><div className="pageHeaderCardSub">Track work time, review entries, and monitor utilization.</div></div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><div className="metricMini"><span>Total logged</span><strong>{formatDuration(totalSeconds)}</strong></div><div className="metricMini"><span>Entries</span><strong>{entriesQ.data?.total ?? 0}</strong></div></div></div></div>
      {error ? <div className="formError">{error}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <section className="panelCard" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Active timer</h3>
          <p style={{ margin: 0, color: 'var(--muted)' }}>{running ? `Running for ${formatDuration(running.duration_seconds)}` : 'No timer is currently running.'}</p>
          <input className="input" value={taskId} disabled={!!running} onChange={e => setTaskId(e.target.value)} placeholder="Optional task ID" />
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" />
          {!running ? <button className="btn btnPrimary" type="button" disabled={startTimer.isPending} onClick={() => startTimer.mutate()}>{startTimer.isPending ? 'Starting…' : 'Start'}</button> : <button className="btn btnPrimary" type="button" disabled={stopTimer.isPending} onClick={() => stopTimer.mutate()}>{stopTimer.isPending ? 'Stopping…' : 'Stop'}</button>}
        </section>
        <section className="panelCard" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Add entry</h3>
          <input className="input" value={entryForm.taskId} onChange={e => setEntryForm(v => ({ ...v, taskId: e.target.value }))} placeholder="Optional task ID" />
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--muted)' }}>Started<input className="input" type="datetime-local" value={entryForm.startedAt} onChange={e => setEntryForm(v => ({ ...v, startedAt: e.target.value }))} /></label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--muted)' }}>Stopped<input className="input" type="datetime-local" value={entryForm.stoppedAt} onChange={e => setEntryForm(v => ({ ...v, stoppedAt: e.target.value }))} /></label>
          <textarea className="input" rows={2} value={entryForm.notes} onChange={e => setEntryForm(v => ({ ...v, notes: e.target.value }))} placeholder="Notes" />
          <button className="btn btnGhost" type="button" disabled={saveEntry.isPending || !entryForm.startedAt || !entryForm.stoppedAt} onClick={() => saveEntry.mutate()}>{saveEntry.isPending ? 'Saving…' : 'Save entry'}</button>
        </section>
      </div>
      {summaryQ.data?.users?.length ? <section className="panelCard" style={{ padding: 16 }}><h3 style={{ marginTop: 0 }}>Team utilization</h3><div style={{ overflowX: 'auto' }}><table className="dataTable"><thead><tr><th>Person</th><th>Time</th><th>Entries</th><th>Tasks</th></tr></thead><tbody>{summaryQ.data.users.map(u => <tr key={u.user_id}><td>{u.user_name}</td><td>{formatDuration(u.total_seconds)}</td><td>{u.entry_count}</td><td>{u.task_count}</td></tr>)}</tbody></table></div></section> : null}
      <section className="panelCard" style={{ padding: 16 }}><h3 style={{ marginTop: 0 }}>Recent entries</h3>{entriesQ.isLoading ? <div className="emptyState">Loading entries…</div> : entriesQ.data?.entries?.length ? <div style={{ overflowX: 'auto' }}><table className="dataTable"><thead><tr><th>When</th><th>Task</th><th>Duration</th><th>Source</th><th>Notes</th></tr></thead><tbody>{entriesQ.data.entries.map(entry => <tr key={entry.id}><td>{new Date(entry.started_at).toLocaleString()}</td><td>{entry.task_title || entry.task_id || 'General work'}</td><td>{entry.stopped_at ? formatDuration(entry.duration_seconds) : 'Running'}</td><td>{entry.source || 'manual'}</td><td>{entry.notes || '—'}</td></tr>)}</tbody></table></div> : <div className="emptyState">No entries yet.</div>}</section>
    </div>
  )
}
