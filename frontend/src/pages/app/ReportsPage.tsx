import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch, ApiError } from '../../lib/api'
import { useState } from 'react'

type ReportRow = {
  id: string
  report_type: string
  scope_type: string
  period_start: string
  period_end: string
  email_sent: boolean
  created_at: string
}

async function fetchReports() {
  const qs = new URLSearchParams({ page: '1', limit: '30' })
  return await apiFetch<{ reports: ReportRow[] }>(`/api/v1/reports?${qs.toString()}`)
}

async function generateReport(reportType: string) {
  return await apiFetch(`/api/v1/reports/generate`, { method: 'POST', json: { reportType } })
}

export function ReportsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['reports', 'list'], queryFn: fetchReports })
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: generateReport,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['reports', 'list'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to generate report.')
    },
  })

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Reports</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Generate on-demand exports and review history.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} disabled={m.isPending} onClick={() => m.mutate('on_demand')}>
              {m.isPending ? 'Generating…' : 'Generate'}
            </button>
            <a className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} href="/api/v1/reports" onClick={(e) => e.preventDefault()}>
              History
            </a>
          </div>
        </div>
        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>

      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError">Failed to load reports.</div> : null}
        {!q.isLoading && (q.data?.reports?.length || 0) === 0 ? (
          <div style={{ color: 'var(--text2)' }}>No reports yet. Generate your first report above.</div>
        ) : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {(q.data?.reports || []).map((r) => (
            <div key={r.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{r.report_type}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {new Date(r.created_at).toLocaleString()} · {r.scope_type}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill pillMuted">{r.email_sent ? 'Emailed' : 'Saved'}</span>
                <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to={`/app/reports/${r.id}`}>
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

