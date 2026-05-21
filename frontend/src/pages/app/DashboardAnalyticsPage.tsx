import { LayoutDashboard } from 'lucide-react'
import { PageHeaderCard } from '../../components/ui/PageHeaderCard'
import { EnhancedDashboardPanel } from '../../components/dashboard/EnhancedDashboardPanel'
import { useLiveAppMetrics } from '../../lib/hooks/useLiveAppMetrics'

export function DashboardAnalyticsPage() {
  const { total, projects, completionRate, overdue } = useLiveAppMetrics(30)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeaderCard
        icon={<LayoutDashboard size={20} strokeWidth={2} />}
        title="Dashboard"
        subtitle={`Real-time analytics · ${total} tasks · ${projects.length} projects · Refreshes every 30s`}
        badges={[
          { label: 'Live data', color: '#22c55e', icon: '●' },
          ...(overdue ? [{ label: `${overdue} overdue`, color: '#ef4444', icon: '⚠' }] : []),
          ...(completionRate !== undefined ? [{ label: `${completionRate}% complete`, color: '#22c55e', icon: '✓' }] : []),
        ]}
      />
      <EnhancedDashboardPanel days={30} />
    </div>
  )
}
