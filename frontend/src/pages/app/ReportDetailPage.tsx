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

function ReportFormattedFallback({ data, reportType }: { data: unknown; reportType?: string }) {
  if (!data || typeof data !== 'object') return (
    <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>No report data available.</div>
  )
  const obj = data as Record<string, unknown>
  const entries = Object.entries(obj).filter(([k]) => k !== 'generatedAt' && k !== 'orgId')
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {reportType && <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{reportType.replace(/_/g, ' ')}</div>}
      {entries.map(([key, val]) => (
        <div key={key}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            {key.replace(/_/g, ' ')}
          </div>
          {Array.isArray(val) ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {(val as Record<string, unknown>[]).slice(0, 20).map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  {Object.entries(row).map(([k, v]) => (
                    <span key={k} style={{ fontSize: 12 }}>
                      <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{k.replace(/_/g, ' ')}: </span>
                      <span style={{ color: 'var(--text)', fontWeight: 800 }}>{String(v ?? '—')}</span>
                    </span>
                  ))}
                </div>
              ))}
              {(val as unknown[]).length > 20 && <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>… and {(val as unknown[]).length - 20} more rows</div>}
            </div>
          ) : typeof val === 'object' && val !== null ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)', minWidth: 100 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase' }}>{k.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--brand)', marginTop: 4 }}>{String(v ?? '—')}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg2)', fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{String(val ?? '—')}</div>
          )}
        </div>
      ))}
    </div>
  )
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
          <ReportFormattedFallback data={report.data ?? report} reportType={report.report_type} />
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
