import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getUser, getAccessToken } from '../../state/auth'

export function DiagnosticsPage() {
  const me = getUser()
  const token = getAccessToken()
  const [results, setResults] = useState<Record<string, any>>({})
  const [running, setRunning] = useState(false)

  async function runTests() {
    setRunning(true)
    const out: Record<string, any> = {}

    // Test 1: Auth check
    out.user = { id: me?.id?.slice(0, 8), role: me?.role, orgId: me?.orgId?.slice(0, 8) }
    out.hasToken = !!token

    // Test 2: Get tasks (GET - should work)
    try {
      const r = await apiFetch<any>('/api/v1/tasks?limit=3&page=1')
      out.getTasks = { ok: true, count: (r.tasks || r.rows || []).length, total: r.pagination?.total }
    } catch (e: any) { out.getTasks = { ok: false, error: e.message, status: e.status } }

    // Test 3: Get assignable users
    try {
      const r = await apiFetch<any>('/api/v1/tasks/assignable-users')
      out.getUsers = { ok: true, count: (r.users || []).length }
    } catch (e: any) { out.getUsers = { ok: false, error: e.message, status: e.status } }

    // Test 4: Get first task ID for status test
    let firstTaskId = ''
    try {
      const r = await apiFetch<any>('/api/v1/tasks?limit=1&page=1')
      const tasks = r.tasks || r.rows || []
      firstTaskId = tasks[0]?.id || ''
      out.firstTask = { id: firstTaskId?.slice(0, 8), status: tasks[0]?.status }
    } catch (e: any) { out.firstTask = { error: e.message } }

    // Test 5: Status change (POST set-status)
    if (firstTaskId) {
      try {
        const r = await apiFetch<any>(`/api/v1/tasks/${firstTaskId}/set-status`, {
          method: 'POST', json: { status: 'pending' }
        })
        out.setStatus = { ok: true, response: r }
      } catch (e: any) { out.setStatus = { ok: false, error: e.message, status: e.status } }
    } else {
      out.setStatus = { skipped: 'no task found' }
    }

    // Test 6: Task creation
    try {
      // First get an assignable user
      const usersR = await apiFetch<any>('/api/v1/tasks/assignable-users')
      const users = usersR.users || []
      const assignTo = users[0]?.id

      if (assignTo) {
        const r = await apiFetch<any>('/api/v1/tasks/create-simple', {
          method: 'POST',
          json: { title: 'Diagnostics Test Task', assignedTo: assignTo, priority: 'low' }
        })
        out.createTask = { ok: true, taskId: r.task?.id?.slice(0, 8) }
        // Clean up — delete it
        try {
          await apiFetch(`/api/v1/tasks/${r.task?.id}`, { method: 'DELETE' })
        } catch (_) {}
      } else {
        out.createTask = { skipped: 'no assignable users found' }
      }
    } catch (e: any) { out.createTask = { ok: false, error: e.message, status: e.status } }

    setResults(out)
    setRunning(false)
  }

  const color = (val: any) => val?.ok === true ? '#22c55e' : val?.ok === false ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 16, fontFamily: 'sans-serif' }}>🔬 Live API Diagnostics</h2>
      <p style={{ color: 'var(--muted)', marginBottom: 20, fontFamily: 'sans-serif', fontSize: 13 }}>
        This page tests all critical API operations in real-time. Share the results to diagnose issues.
      </p>
      <button
        onClick={runTests}
        disabled={running}
        style={{ padding: '10px 24px', borderRadius: 999, border: 'none', background: '#e2ab41', color: '#000', fontWeight: 900, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer', marginBottom: 24 }}
      >
        {running ? '⏳ Running tests...' : '▶ Run Diagnostics'}
      </button>

      {Object.keys(results).length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {Object.entries(results).map(([key, val]) => (
            <div key={key} style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--bg1)', border: `2px solid ${color(val)}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 900, color: 'var(--text)', fontSize: 14 }}>{key}</span>
                <span style={{ fontWeight: 900, color: color(val), fontSize: 12 }}>
                  {val?.ok === true ? '✓ PASS' : val?.ok === false ? '✗ FAIL' : val?.skipped ? '— SKIPPED' : '📋 INFO'}
                </span>
              </div>
              <pre style={{ margin: 0, color: color(val), background: 'var(--bg2)', padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 11, lineHeight: 1.5 }}>
                {JSON.stringify(val, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
