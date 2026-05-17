import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/inter/latin.css'
import './index.css'       // design tokens, keyframes, base component classes
import './overrides.css'   // component layout overrides, grid utilities
import './app-patches.css' // all feature-specific patches (consolidated from 28 files)
import './overlay-upgrade-fixes.css' // final z-index, dropdown, and mobile notification fixes
import './dashboard-modern-chart-upgrade.css' // modern realtime dashboard visualization styles
import './theme-overhaul.css' // FINAL: brand colors, capsule buttons, typography, no oval cards
import './grid-system.css' // Grid system: alignment, spacing, hierarchy, consistency
import './task-checkbox-event-guard'
import './global-search-submit'
import './employee-profile-delete-action'
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
