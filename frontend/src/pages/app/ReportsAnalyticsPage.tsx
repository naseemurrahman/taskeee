import { ReportAnalyticsPanel } from '../../components/reports/ReportAnalyticsPanel'
import { ReportsPage } from './ReportsPage'

function RecordsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', padding: 16, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontWeight: 950 }}>
        <span>{title}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 800 }}>Open records</span>
      </summary>
      <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>{children}</div>
    </details>
  )
}

export function ReportsAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <ReportAnalyticsPanel days={30} />
      <RecordsSection title="Report records and generation">
        <ReportsPage />
      </RecordsSection>
    </div>
  )
}
