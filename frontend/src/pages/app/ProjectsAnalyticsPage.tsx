import { ProjectAnalyticsPanel } from '../../components/projects/ProjectAnalyticsPanel'
import { ProjectsPage } from './ProjectsPage'

export function ProjectsAnalyticsPage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <ProjectAnalyticsPanel />
      <ProjectsPage />
    </div>
  )
}
