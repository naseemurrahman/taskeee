import { RecordsSection } from '../../components/layout/RecordsSection'
import { ProjectAnalyticsPanel } from '../../components/projects/ProjectAnalyticsPanel'
import { ProjectsPage } from './ProjectsPage'

export function ProjectsAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <ProjectAnalyticsPanel />
      <RecordsSection title="Project records and actions">
        <ProjectsPage />
      </RecordsSection>
    </div>
  )
}
