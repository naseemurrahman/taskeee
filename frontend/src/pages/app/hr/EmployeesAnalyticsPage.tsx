import { EmployeeAnalyticsPanel } from '../../../components/employees/EmployeeAnalyticsPanel'
import { EmployeesPage } from './EmployeesPage'

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

export function EmployeesAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <EmployeeAnalyticsPanel days={30} />
      <RecordsSection title="Employee records and actions">
        <EmployeesPage />
      </RecordsSection>
    </div>
  )
}
