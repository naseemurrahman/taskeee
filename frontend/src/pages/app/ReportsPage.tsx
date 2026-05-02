import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch, getApiErrorMessage } from '../../lib/api'
import { useState } from 'react'
import { getAccessToken } from '../../state/auth'

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

function downloadReportCsv(rows: ReportRow[], orgName?: string) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '-')
  const org = orgName ? orgName.replace(/[^a-z0-9]/gi, '-').toLowerCase() : 'org'
  const csvRows = [
    // Header with metadata
    [`# TaskFlow Pro — Report Export`],
    [`# Organization: ${orgName || 'Unknown'}`],
    [`# Exported: ${now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`],
    [`# Total records: ${rows.length}`],
    [],
    ['Report Type', 'Scope', 'Period Start', 'Period End', 'Emailed', 'Created At'],
    ...rows.map(r => [
      r.report_type,
      r.scope_type,
      r.period_start ? new Date(r.period_start).toLocaleDateString() : '',
      r.period_end   ? new Date(r.period_end).toLocaleDateString()   : '',
      r.email_sent ? 'Yes' : 'No',
      r.created_at  ? new Date(r.created_at).toLocaleString() : '',
    ]),
  ]
  const csv = csvRows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `taskflow-${org}-reports-${dateStr}-${timeStr}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadReportPdf(reportId: string) {
  const res = await fetch(`/api/v1/reports/${encodeURIComponent(reportId)}/export?format=pdf`, {
    headers: { Authorization: `Bearer ${getAccessToken() || ''}` },
  })
  if (!res.ok) throw new Error('PDF export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-${reportId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage() {
  const qc = useQueryClient()
  const orgQ = useQuery({
    queryKey: ['org', 'reports-page'],
    queryFn: () => apiFetch<{ organization?: { name?: string } }>('/api/v1/organizations/me').then(d => d.organization?.name || ''),
    staleTime: 300_000,
  })
  const q = useQuery({
    queryKey: ['reports', 'list'],
    queryFn: fetchReports,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: generateReport,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['reports', 'list'] })
    },
    onError: (err) => {
      setError(getApiErrorMessage(err, 'Failed to generate report.'))
    },
  })

  const listError = getApiErrorMessage(q.error, 'Failed to load reports.')

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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" style={{ height: 40, padding: '0 12px' }} disabled={m.isPending} onClick={() => m.mutate('task_completion')}>
              {m.isPending ? 'Generating…' : 'Task Completion'}
            </button>
            <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} disabled={m.isPending} onClick={() => m.mutate('employee_performance')}>
              Employee Performance
            </button>
            <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} disabled={m.isPending} onClick={() => m.mutate('project_summary')}>
              Project Summary
            </button>
            <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => downloadReportCsv(q.data?.reports || [], orgQ.data || '')}>
              Export CSV
            </button>
            <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => {
              const first = q.data?.reports?.[0]
              if (first) void downloadReportPdf(first.id)
            }}>
              Export Latest PDF
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="alertV4 alertV4Error">{error}</div> : null}

      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alertV4 alertV4Error">{listError}</div> : null}
        {!q.isLoading && (q.data?.reports?.length || 0) === 0 ? (
          <div className="emptyStateV3">
            <div className="emptyStateV3Icon">📋</div>
            <div className="emptyStateV3Title">No reports yet</div>
            <div className="emptyStateV3Body">Click "Generate" above to create your first report snapshot.</div>
          </div>
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
                <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} type="button" onClick={() => void downloadReportPdf(r.id)}>
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
