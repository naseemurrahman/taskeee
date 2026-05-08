import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/inter/latin.css'
import './index.css'
import './overrides.css'
import './responsive-fixes.css'
import './design-polish.css'
import './notification-popover-fixes.css'
import './search-page.css'
import './task-ui-polish.css'
import './responsive-hardening.css'
import './checkbox-hitbox-fix.css'
import './checkbox-final-fix.css'
import './mobile-select-and-projects.css'
import './ux-polish.css'
import './marketing-polish.css'
import './create-task-modal-polish.css'
import './tasks-mobile-selection-qa.css'
import './project-visibility-final-qa.css'
import './recurring-tasks.css'
import './mobile-ux-final-polish.css'
import './responsive-master.css'
import './ui-cleanup-projects-notifications-tasks.css'
import './sidebar-scroll-fix.css'
import './app-design-polish.css'
import './app-final-screen-fixes.css'
import './marketing-final-polish.css'
import './analytics-final-polish.css'
import './work-pages-mobile-polish.css'
import './my-tasks-pro.css'
import './role-scope-and-mobile-grid.css'
import './app-card-grid-standard.css'
import './final-shape-notify-fix.css'
import './task-checkbox-event-guard'
import App from './App.tsx'
import { I18nProvider } from './i18n'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/ui/ToastSystem'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 2 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: (failureCount, error: any) => {
        if (error?.status >= 400 && error?.status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="application">
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <BrowserRouter>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => null)
  })
}
