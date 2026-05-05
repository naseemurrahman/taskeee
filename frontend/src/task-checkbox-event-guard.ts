/*
 * Professional task-table checkbox behavior.
 *
 * TasksPage rows open a drawer on row click. This guard makes checkbox cells
 * reliable selection controls, fixes select-all in the table header, and keeps
 * mobile card checkbox taps from bubbling into the row drawer click.
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

function setCheckbox(box: HTMLInputElement, checked: boolean) {
  if (box.checked === checked) return
  box.checked = checked
  box.dispatchEvent(new Event('change', { bubbles: true }))
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

function toggleVisibleRowsFromHeader(headerCheckbox: HTMLInputElement) {
  const table = headerCheckbox.closest('.tasksTable')
  if (!table) return
  const boxes = rowSelectionCheckboxes(table).filter(b => !b.disabled)
  if (!boxes.length) return
  const shouldCheck = !boxes.every(b => b.checked)
  for (const box of boxes) setCheckbox(box, shouldCheck)
}

function toggleSingleCheckbox(checkbox: HTMLInputElement) {
  setCheckbox(checkbox, !checkbox.checked)
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

  document.addEventListener('mousedown', (event) => {
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
  }, true)

  document.addEventListener('touchstart', (event) => {
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
  }, { capture: true, passive: true })

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
      toggleSingleCheckbox(checkbox)
    }
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const hit = getSelectionCell(event.target)
    if (!hit) return
    event.stopPropagation()
    event.preventDefault()
    if (hit.isHeader) toggleVisibleRowsFromHeader(hit.checkbox)
    else toggleSingleCheckbox(hit.checkbox)
  }, true)
}

installTaskCheckboxEventGuard()

export {}
