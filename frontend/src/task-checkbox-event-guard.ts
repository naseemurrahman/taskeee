/*
 * Professional task-table checkbox behavior.
 *
 * TasksPage rows open a drawer on row click. This guard makes checkbox cells
 * reliable selection controls and fixes select-all in the table header.
 */
function isPrimaryClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function getSelectionCell(target: EventTarget | null): { cell: HTMLTableCellElement; checkbox: HTMLInputElement; isHeader: boolean } | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest('td,th') as HTMLTableCellElement | null
  if (!cell) return null
  const table = cell.closest('.tasksTable')
  if (!table) return null
  const checkbox = cell.querySelector("input[type='checkbox']") as HTMLInputElement | null
  if (!checkbox || checkbox.disabled) return null
  return { cell, checkbox, isHeader: cell.tagName.toLowerCase() === 'th' }
}

function rowSelectionCheckboxes(table: Element): HTMLInputElement[] {
  return Array.from(table.querySelectorAll("tbody td input[type='checkbox']")) as HTMLInputElement[]
}

function toggleVisibleRowsFromHeader(headerCheckbox: HTMLInputElement) {
  const table = headerCheckbox.closest('.tasksTable')
  if (!table) return
  const boxes = rowSelectionCheckboxes(table).filter(b => !b.disabled)
  if (!boxes.length) return
  const allChecked = boxes.every(b => b.checked)
  for (const box of boxes) {
    if (allChecked ? box.checked : !box.checked) box.click()
  }
}

function installTaskCheckboxEventGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if ((window as any).__taskCheckboxEventGuardInstalled) return
  ;(window as any).__taskCheckboxEventGuardInstalled = true

  document.addEventListener('pointerdown', (event) => {
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
  }, true)

  document.addEventListener('click', (event) => {
    if (!isPrimaryClick(event)) return

    const hit = getSelectionCell(event.target)
    if (!hit) return

    const { checkbox, isHeader } = hit
    const target = event.target

    event.stopPropagation()

    if (isHeader) {
      event.preventDefault()
      checkbox.focus({ preventScroll: true })
      toggleVisibleRowsFromHeader(checkbox)
      return
    }

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
    if (hit.isHeader) {
      event.preventDefault()
      toggleVisibleRowsFromHeader(hit.checkbox)
    }
  }, true)
}

installTaskCheckboxEventGuard()

export {}
