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
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Reports
            </div>
            <div className="pageHeaderCardSub">Generate performance and task reports for your organization. Reports capture a snapshot of task states, scores, and team metrics.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📋</span> Generate reports</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📥</span> Download PDF/CSV</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🕐</span> Historical snapshots</span>
            </div>
          </div>
        </div>
      </div>

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

