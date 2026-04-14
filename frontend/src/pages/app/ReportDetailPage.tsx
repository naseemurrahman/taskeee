import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

type Report = {
  id: string
  report_type: string
  scope_type: string
  created_at: string
  data?: unknown
}

type ReportPayload = {
  user?: { id?: string; fullName?: string; role?: string }
  period?: { start?: string; end?: string; type?: string }
  summary?: {
    total?: number
    completed?: number
    completionRate?: string | number
    overdueTasks?: number
  }
  statusBreakdown?: Array<{ status: string; count: string | number; avg_hours?: number | null }>
  overdueTasks?: Array<{ title: string; due_date?: string; assigned_to_name?: string }>
  aiStats?: { total?: number; approved?: number; rejected?: number }
  topPerformers?: Array<{ full_name?: string; email?: string; completed?: string | number; total?: string | number }>
  generatedAt?: string
}

function parsePayload(raw: unknown): ReportPayload | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ReportPayload
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return raw as ReportPayload
  return null
}

async function fetchReport(id: string) {
  return await apiFetch<{ report: Report }>(`/api/v1/reports/${encodeURIComponent(id)}`)
}

export function ReportDetailPage() {
  const { id } = useParams()
  const rid = id || ''
  const q = useQuery({ queryKey: ['reports', 'detail', rid], queryFn: () => fetchReport(rid), enabled: !!rid })

  const report = q.data?.report
  const payload = useMemo(() => parsePayload(report?.data), [report?.data])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Report</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>
              {report ? `${report.report_type} · ${new Date(report.created_at).toLocaleString()}` : 'Loading…'}
            </div>
          </div>
          <div className="reportToolbar">
            <Link className="btn btnGhost reportToolbarBtn" to="/app/reports">
              Back
            </Link>
            {rid ? (
              <>
                <a className="btn btnPrimary reportToolbarBtn" href={`/api/v1/reports/${encodeURIComponent(rid)}/export?format=json`}>
                  Download JSON
                </a>
                <a className="btn btnGhost reportToolbarBtn" href={`/api/v1/reports/${encodeURIComponent(rid)}/export?format=csv`}>
                  Download CSV
                </a>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError">Failed to load report.</div> : null}
        {report && !payload ? (
          <pre className="reportRawFallback">{JSON.stringify(report.data ?? report, null, 2)}</pre>
        ) : null}
        {payload ? (
          <div className="reportDashboard">
            {payload.user ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Scope</div>
                <div className="reportKpiGrid">
                  <div className="reportKpi">
                    <span className="reportKpiLabel">Viewer</span>
                    <span className="reportKpiValue">{payload.user.fullName || '—'}</span>
                  </div>
                  <div className="reportKpi">
                    <span className="reportKpiLabel">Role</span>
                    <span className="reportKpiValue">{payload.user.role || '—'}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {payload.period ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Period</div>
                <p className="reportMuted">
                  {payload.period.type || 'report'} ·{' '}
                  {payload.period.start ? new Date(payload.period.start).toLocaleString() : '—'} →{' '}
                  {payload.period.end ? new Date(payload.period.end).toLocaleString() : '—'}
                </p>
              </div>
            ) : null}

            {payload.summary ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Summary</div>
                <div className="reportStatGrid">
                  <div className="reportStatCard">
                    <div className="reportStatN">{payload.summary.total ?? 0}</div>
                    <div className="reportStatL">Tasks in period</div>
                  </div>
                  <div className="reportStatCard">
                    <div className="reportStatN">{payload.summary.completed ?? 0}</div>
                    <div className="reportStatL">Completed</div>
                  </div>
                  <div className="reportStatCard">
                    <div className="reportStatN">{payload.summary.overdueTasks ?? 0}</div>
                    <div className="reportStatL">Open overdue</div>
                  </div>
                  <div className="reportStatCard reportStatCardAccent">
                    <div className="reportStatN">{payload.summary.completionRate ?? 0}%</div>
                    <div className="reportStatL">Completion rate</div>
                  </div>
                </div>
              </div>
            ) : null}

            {payload.aiStats && (payload.aiStats.total ?? 0) > 0 ? (
              <div className="reportSection">
                <div className="reportSectionTitle">AI photo review</div>
                <div className="reportKpiGrid">
                  <div className="reportKpi">
                    <span className="reportKpiLabel">Reviewed</span>
                    <span className="reportKpiValue">{payload.aiStats.total ?? 0}</span>
                  </div>
                  <div className="reportKpi">
                    <span className="reportKpiLabel">Approved</span>
                    <span className="reportKpiValue">{payload.aiStats.approved ?? 0}</span>
                  </div>
                  <div className="reportKpi">
                    <span className="reportKpiLabel">Rejected</span>
                    <span className="reportKpiValue">{payload.aiStats.rejected ?? 0}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {payload.statusBreakdown && payload.statusBreakdown.length > 0 ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Status breakdown</div>
                <div className="reportBars">
                  {payload.statusBreakdown.map((row) => {
                    const n = Math.max(0, Number(row.count) || 0)
                    const max = Math.max(1, ...payload.statusBreakdown!.map((r) => Number(r.count) || 0))
                    const pct = Math.round((n / max) * 100)
                    return (
                      <div key={row.status} className="reportBarRow">
                        <div className="reportBarLabel">{row.status.replace(/_/g, ' ')}</div>
                        <div className="reportBarTrack">
                          <div className="reportBarFill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="reportBarCount">{n}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {payload.overdueTasks && payload.overdueTasks.length > 0 ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Overdue tasks (sample)</div>
                <div className="reportTableWrap">
                  <table className="reportTable">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Assignee</th>
                        <th>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.overdueTasks.map((t, i) => (
                        <tr key={`${t.title}-${i}`}>
                          <td>{t.title}</td>
                          <td>{t.assigned_to_name || '—'}</td>
                          <td>{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {payload.topPerformers && payload.topPerformers.length > 0 ? (
              <div className="reportSection">
                <div className="reportSectionTitle">Top performers</div>
                <div className="reportTableWrap">
                  <table className="reportTable">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Completed</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.topPerformers.map((p, i) => (
                        <tr key={`${p.full_name}-${i}`}>
                          <td>{p.full_name || '—'}</td>
                          <td>{p.completed ?? 0}</td>
                          <td>{p.total ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {payload.generatedAt ? (
              <div className="reportFooterMuted">Generated {new Date(payload.generatedAt).toLocaleString()}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
