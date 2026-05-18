import { RecordsSection } from '../../components/layout/RecordsSection'
import { ReportAnalyticsPanel } from '../../components/reports/ReportAnalyticsPanel'
import { ReportsPage } from './ReportsPage'

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
