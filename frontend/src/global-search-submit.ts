function routeToSearch(query: string) {
  const q = query.trim()
  if (q.length < 2) return
  window.location.assign(`/app/search?q=${encodeURIComponent(q)}`)
}

export function installGlobalSearchSubmit() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const marker = '__taskeeGlobalSearchSubmitInstalled'
  const anyWindow = window as typeof window & Record<string, unknown>
  if (anyWindow[marker]) return
  anyWindow[marker] = true

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement | null
    if (!(target instanceof HTMLInputElement)) return
    if (!target.classList.contains('topbarV4SearchInput')) return
    event.preventDefault()
    routeToSearch(target.value)
  })

  document.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement | null
    const dropdown = target?.closest?.('.topbarV4SearchDropdown') as HTMLElement | null
    if (!dropdown) return
    const input = document.querySelector<HTMLInputElement>('.topbarV4SearchInput')
    if (!input) return
    event.preventDefault()
    routeToSearch(input.value)
  })
}

installGlobalSearchSubmit()
