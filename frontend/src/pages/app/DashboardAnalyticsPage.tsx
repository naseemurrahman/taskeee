import { LayoutDashboard } from 'lucide-react'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { EnhancedDashboardPanel } from '../../components/dashboard/EnhancedDashboardPanel'
import { useLiveAppMetrics } from '../../lib/hooks/useLiveAppMetrics'

export function DashboardAnalyticsPage() {
  const metrics = useLiveAppMetrics(30)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeaderCard
        icon={<LayoutDashboard size={20} strokeWidth={2} />}
        title="Dashboard"
        subtitle={`Real-time analytics · ${metrics.total} tasks · ${metrics.projects?.length ?? 0} projects`}
        badges={[
          { label: 'Live data', color: '#22c55e', icon: '●' },
          ...(metrics.overdue ? [{ label: `${metrics.overdue} overdue`, color: '#ef4444', icon: '⚠' }] : []),
          { label: `${metrics.completionRate}% complete`, color: '#22c55e', icon: '✓' },
        ]}
      />
      <ErrorBoundary label="dashboard">
        <EnhancedDashboardPanel days={30} metrics={metrics} />
      </ErrorBoundary>
    </div>
  )
}
