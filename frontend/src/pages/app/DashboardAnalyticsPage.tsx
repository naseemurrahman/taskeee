import { DashboardAnalyticsPanel } from '../../components/dashboard/DashboardAnalyticsPanel'
import { DashboardHomePage } from './DashboardHomePage'

export function DashboardAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <DashboardAnalyticsPanel days={30} />
      <DashboardHomePage />
    </div>
  )
}
