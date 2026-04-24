import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SignInPage } from './pages/SignInPage'
import { SignUpPage } from './pages/SignUpPage'
import { MfaPage } from './pages/MfaPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AppLayout } from './shell/AppLayout'
import { DashboardHomePage } from './pages/app/DashboardHomePage'
import { getUser, isAuthed } from './state/auth'
import { TasksPage } from './pages/app/TasksPage'
import { MyTasksPage } from './pages/app/MyTasksPage'
import { ProjectsPage } from './pages/app/ProjectsPage'
import { BoardPage } from './pages/app/BoardPage'
import { AnalyticsPage } from './pages/app/AnalyticsPage'
import { EmployeesPage } from './pages/app/hr/EmployeesPage'
import { EmployeeProfilePage } from './pages/app/hr/EmployeeProfilePage'
import { TimeOffPage } from './pages/app/hr/TimeOffPage'
import { CrmPipelinePage } from './pages/app/crm/CrmPipelinePage'
import { CrmLeadsPage } from './pages/app/crm/CrmLeadsPage'
import { BillingPage } from './pages/app/BillingPage'
import { ContractorsPage } from './pages/app/contractors/ContractorsPage'
import { ContractorProfilePage } from './pages/app/contractors/ContractorProfilePage'
import { JeczoneDashboardPage } from './pages/app/jeczone/JeczoneDashboardPage'
import { CalendarPage } from './pages/app/CalendarPage'
import { ReportsPage } from './pages/app/ReportsPage'
import { ReportDetailPage } from './pages/app/ReportDetailPage'
import { AuditPage } from './pages/app/AuditPage'
import { ProfilePage } from './pages/app/ProfilePage'
import { LogsPage } from './pages/app/LogsPage'
import { MarketingLayout } from './pages/marketing/MarketingLayout'
import { MarketingHomePage } from './pages/marketing/MarketingHomePage'
import { PricingPage } from './pages/marketing/PricingPage'
import React from 'react'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  if (!isAuthed()) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/signin?next=${next}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  const role = getUser()?.role || 'employee'
  const tasksHome = ['employee', 'supervisor'].includes(role) ? <MyTasksPage /> : <TasksPage />

  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<MarketingHomePage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Route>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/mfa" element={<MfaPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardHomePage />} />
        <Route path="tasks" element={tasksHome} />
        <Route path="my-tasks" element={<Navigate to="/app/tasks" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        {/* /app/team → merged into HR employees */}
        <Route path="team" element={<Navigate to="/app/hr/employees" replace />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="hr/employees" element={<EmployeesPage />} />
        <Route path="hr/employees/:id" element={<EmployeeProfilePage />} />
        <Route path="hr/time-off" element={<TimeOffPage />} />
        <Route path="crm/pipeline" element={<CrmPipelinePage />} />
        <Route path="crm/leads" element={<CrmLeadsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="contractors" element={<ContractorsPage />} />
        <Route path="contractors/:id" element={<ContractorProfilePage />} />
        <Route path="jeczone" element={<JeczoneDashboardPage />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
