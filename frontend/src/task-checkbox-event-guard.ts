/*
 * Professional task-table checkbox behavior.
 *
 * TasksPage rows open a drawer on row click. This guard makes checkbox cells
 * behave like data-table selection controls without blocking React's controlled
 * checkbox onChange handlers. It fixes both row checkboxes and the select-all
 * header checkbox.
 */
function isPrimaryClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function getSelectionCell(target: EventTarget | null): { cell: HTMLTableCellElement; checkbox: HTMLInputElement } | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest('td,th') as HTMLTableCellElement | null
  if (!cell) return null
  const table = cell.closest('.tasksTable')
  if (!table) return null
  const checkbox = cell.querySelector("input[type='checkbox']") as HTMLInputElement | null
  if (!checkbox || checkbox.disabled) return null
  return { cell, checkbox }
}

function installTaskCheckboxEventGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if ((window as any).__taskCheckboxEventGuardInstalledV2) return
  ;(window as any).__taskCheckboxEventGuardInstalledV2 = true

  // Capture phase: only forward clicks from checkbox-cell padding to the actual
  // checkbox. Do not stop native checkbox clicks here, because React's delegated
  // onChange must still receive the event.
  document.addEventListener('click', (event) => {
    if (!isPrimaryClick(event)) return
    const hit = getSelectionCell(event.target)
    if (!hit) return

    const { checkbox } = hit
    if (event.target === checkbox) return

    event.preventDefault()
    event.stopPropagation()
    checkbox.focus({ preventScroll: true })
    checkbox.click()
  }, true)

  // Bubble phase: stop real checkbox clicks from reaching the table row and
  // opening the drawer. React's onChange has already had a chance to run.
  document.addEventListener('click', (event) => {
    const hit = getSelectionCell(event.target)
    if (!hit) return
    if (event.target === hit.checkbox) event.stopPropagation()
  }, false)

  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
  }, true)
}

installTaskCheckboxEventGuard()

export {}
