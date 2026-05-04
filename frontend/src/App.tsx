import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isAuthed } from './state/auth'
import { SessionGuard } from './components/SessionGuard'

// ── Eagerly loaded (needed immediately on any first paint) ────────────────────
import { AppLayout }         from './shell/AppLayout'
import { SignInPage }        from './pages/SignInPage'
import { SignUpPage }        from './pages/SignUpPage'
import { MarketingLayout }   from './pages/marketing/MarketingLayout'
import { MarketingHomePage } from './pages/marketing/MarketingHomePage'

// ── Lazy-loaded app pages (split into separate chunks) ────────────────────────
const DashboardHomePage     = lazy(() => import('./pages/app/DashboardHomePage').then(m => ({ default: m.DashboardHomePage })))
const TasksPage             = lazy(() => import('./pages/app/TasksPage').then(m => ({ default: m.TasksPage })))
const MyTasksPage           = lazy(() => import('./pages/app/MyTasksPage').then(m => ({ default: m.MyTasksPage })))
const ProjectsPage          = lazy(() => import('./pages/app/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const BoardPage             = lazy(() => import('./pages/app/BoardPage').then(m => ({ default: m.BoardPage })))
const CalendarPage          = lazy(() => import('./pages/app/CalendarPage').then(m => ({ default: m.CalendarPage })))
const AnalyticsPage         = lazy(() => import('./pages/app/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const InsightsPage          = lazy(() => import('./pages/app/InsightsPage').then(m => ({ default: m.InsightsPage })))
const ReportsPage           = lazy(() => import('./pages/app/ReportsPage').then(m => ({ default: m.ReportsPage })))
const ReportDetailPage      = lazy(() => import('./pages/app/ReportDetailPage').then(m => ({ default: m.ReportDetailPage })))
const AuditPage             = lazy(() => import('./pages/app/AuditPage').then(m => ({ default: m.AuditPage })))
const LogsPage              = lazy(() => import('./pages/app/LogsPage').then(m => ({ default: m.LogsPage })))
const ProfilePage           = lazy(() => import('./pages/app/ProfilePage').then(m => ({ default: m.ProfilePage })))
const SettingsPage          = lazy(() => import('./pages/app/SettingsPage').then(m => ({ default: m.SettingsPage })))
const BillingPage           = lazy(() => import('./pages/app/BillingPage').then(m => ({ default: m.BillingPage })))
const OnboardingPage        = lazy(() => import('./pages/app/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const DiagnosticsPage       = lazy(() => import('./pages/app/DiagnosticsPage').then(m => ({ default: m.DiagnosticsPage })))
const SearchPage            = lazy(() => import('./pages/app/SearchPage').then(m => ({ default: m.SearchPage })))
const JeczoneDashboardPage  = lazy(() => import('./pages/app/jeczone/JeczoneDashboardPage').then(m => ({ default: m.JeczoneDashboardPage })))
const EmployeesPage         = lazy(() => import('./pages/app/hr/EmployeesPage').then(m => ({ default: m.EmployeesPage })))
const EmployeeProfilePage   = lazy(() => import('./pages/app/hr/EmployeeProfilePage').then(m => ({ default: m.EmployeeProfilePage })))
const TimeOffPage           = lazy(() => import('./pages/app/hr/TimeOffPage').then(m => ({ default: m.TimeOffPage })))
const ContractorsPage       = lazy(() => import('./pages/app/contractors/ContractorsPage').then(m => ({ default: m.ContractorsPage })))
const ContractorProfilePage = lazy(() => import('./pages/app/contractors/ContractorProfilePage').then(m => ({ default: m.ContractorProfilePage })))
const CrmPipelinePage       = lazy(() => import('./pages/app/crm/CrmPipelinePage').then(m => ({ default: m.CrmPipelinePage })))
const CrmLeadsPage          = lazy(() => import('./pages/app/crm/CrmLeadsPage').then(m => ({ default: m.CrmLeadsPage })))
const PricingPage           = lazy(() => import('./pages/marketing/PricingPage').then(m => ({ default: m.PricingPage })))
const MfaPage               = lazy(() => import('./pages/MfaPage').then(m => ({ default: m.MfaPage })))
const VerifyEmailPage       = lazy(() => import('./pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })))
const ForgotPasswordPage    = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage     = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))

// ── Spinner shown while a chunk loads ────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <div style={{ width: 36, height: 36, border: '3px solid rgba(226,171,65,0.2)', borderTopColor: '#e2ab41', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  if (!isAuthed()) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/signin?next=${next}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <>
      <SessionGuard />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Marketing */}
          <Route element={<MarketingLayout />}>
            <Route path="/"      element={<MarketingHomePage />} />
            <Route path="/home"  element={<Navigate to="/" replace />} />
            <Route path="/pricing" element={<PricingPage />} />
          </Route>

          {/* Auth */}
          <Route path="/signin"         element={<SignInPage />} />
          <Route path="/signup"         element={<SignUpPage />} />
          <Route path="/mfa"            element={<MfaPage />} />
          <Route path="/verify-email"   element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* App (authenticated) */}
          <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index                        element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard"             element={<DashboardHomePage />} />
            <Route path="diagnostics"           element={<DiagnosticsPage />} />
            <Route path="search"                element={<SearchPage />} />
            <Route path="tasks"                 element={<TasksPage />} />
            <Route path="my-tasks"              element={<MyTasksPage />} />
            <Route path="projects"              element={<ProjectsPage />} />
            <Route path="board"                 element={<BoardPage />} />
            <Route path="calendar"              element={<CalendarPage />} />
            <Route path="team"                  element={<Navigate to="/app/hr/employees" replace />} />
            <Route path="reports"               element={<ReportsPage />} />
            <Route path="reports/:id"           element={<ReportDetailPage />} />
            <Route path="audit"                 element={<AuditPage />} />
            <Route path="logs"                  element={<LogsPage />} />
            <Route path="profile"               element={<ProfilePage />} />
            <Route path="analytics"             element={<AnalyticsPage />} />
            <Route path="insights"              element={<InsightsPage />} />
            <Route path="hr/employees"          element={<EmployeesPage />} />
            <Route path="hr/employees/:id"      element={<EmployeeProfilePage />} />
            <Route path="hr/time-off"           element={<TimeOffPage />} />
            <Route path="crm/pipeline"          element={<CrmPipelinePage />} />
            <Route path="crm/leads"             element={<CrmLeadsPage />} />
            <Route path="settings"              element={<SettingsPage />} />
            <Route path="onboarding"            element={<OnboardingPage />} />
            <Route path="billing"               element={<BillingPage />} />
            <Route path="contractors"           element={<ContractorsPage />} />
            <Route path="contractors/:id"       element={<ContractorProfilePage />} />
            <Route path="jeczone"               element={<JeczoneDashboardPage />} />
            <Route path="*"                     element={<Navigate to="/app/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
