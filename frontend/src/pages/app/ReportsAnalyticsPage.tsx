import { ReportAnalyticsPanel } from '../../components/reports/ReportAnalyticsPanel'
import { ReportsPage } from './ReportsPage'

export function ReportsAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <ReportAnalyticsPanel days={30} />
      <ReportsPage />
    </div>
  )
}
