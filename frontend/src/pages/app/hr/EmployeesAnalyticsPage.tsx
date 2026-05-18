import { EmployeeAnalyticsPanel } from '../../../components/employees/EmployeeAnalyticsPanel'
import { EmployeesPage } from './EmployeesPage'

export function EmployeesAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <EmployeeAnalyticsPanel days={30} />
      <EmployeesPage />
    </div>
  )
}
