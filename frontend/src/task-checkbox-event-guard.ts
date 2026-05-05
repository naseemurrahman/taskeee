/*
 * Professional task-table checkbox behavior.
 *
 * TasksPage rows open a drawer on row click. Without an explicit event boundary,
 * checkbox clicks can fight the row click handler and feel inconsistent at the
 * top/edge of the visible checkbox. This guard uses event delegation to make the
 * entire checkbox cell behave like a standard data-table selection control.
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
  if ((window as any).__taskCheckboxEventGuardInstalled) return
  ;(window as any).__taskCheckboxEventGuardInstalled = true

  document.addEventListener('click', (event) => {
    if (!isPrimaryClick(event)) return

    const hit = getSelectionCell(event.target)
    if (!hit) return

    const { checkbox } = hit
    const target = event.target

    // Always isolate selection from the row's drawer-opening onClick handler.
    event.stopPropagation()

    // If the user clicked the cell padding or pseudo/visual hit area, forward the
    // click to the real checkbox so React's controlled onChange still runs.
    if (target !== checkbox) {
      event.preventDefault()
      checkbox.focus({ preventScroll: true })
      checkbox.click()
    }
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
  }, true)
}

installTaskCheckboxEventGuard()

export {}
