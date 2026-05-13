import { apiFetch } from './lib/api'

function currentEmployeeId(): string | null {
  const match = window.location.pathname.match(/^\/app\/hr\/employees\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function ensureDeleteAction() {
  const employeeId = currentEmployeeId()
  if (!employeeId) return
  if (document.querySelector('[data-employee-delete-action="true"]')) return

  const headerInner = document.querySelector<HTMLElement>('.pageHeaderCardInner')
  if (!headerInner) return

  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.employeeDeleteAction = 'true'
  button.className = 'btn btnGhost'
  button.textContent = 'Delete employee'
  button.style.height = '40px'
  button.style.display = 'grid'
  button.style.placeItems = 'center'
  button.style.padding = '0 12px'
  button.style.borderColor = 'rgba(239,68,68,0.35)'
  button.style.color = '#ef4444'

  button.addEventListener('click', async () => {
    const id = currentEmployeeId()
    if (!id) return
    const confirmed = window.confirm('Delete this employee and deactivate the linked workspace account? This action cannot be undone.')
    if (!confirmed) return

    const previous = button.textContent
    button.disabled = true
    button.textContent = 'Deleting…'
    try {
      await apiFetch(`/api/v1/hris/employees/${encodeURIComponent(id)}`, { method: 'DELETE' })
      window.location.assign('/app/hr/employees')
    } catch (err: any) {
      window.alert(err?.message || 'Could not delete employee.')
      button.disabled = false
      button.textContent = previous
    }
  })

  headerInner.appendChild(button)
}

export function installEmployeeProfileDeleteAction() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const marker = '__taskeeEmployeeProfileDeleteActionInstalled'
  const anyWindow = window as typeof window & Record<string, unknown>
  if (anyWindow[marker]) return
  anyWindow[marker] = true

  const observer = new MutationObserver(() => ensureDeleteAction())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', () => setTimeout(ensureDeleteAction, 0))
  document.addEventListener('click', () => setTimeout(ensureDeleteAction, 0), true)
  ensureDeleteAction()
}

installEmployeeProfileDeleteAction()
