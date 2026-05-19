/*
 * Deprecated event guard.
 *
 * The original implementation used global capture-phase listeners to manually
 * toggle task table checkboxes. That made selection reliable, but it also
 * coupled row selection to document-level DOM mutation.
 *
 * Current behavior is handled without document event listeners: row checkbox
 * inputs are made non-pointer targets so the owning checkbox cell handles one
 * click toggle only, while the header checkbox keeps native input behavior.
 */
function installTaskCheckboxStyleGuard() {
  if (typeof document === 'undefined') return
  const id = 'task-checkbox-cell-behavior'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .tasksTable tbody td.thCheckbox { cursor: pointer; }
    .tasksTable tbody td.thCheckbox input.taskCheckbox { pointer-events: none; }
    .tasksTable thead th.thCheckbox input.taskCheckbox { pointer-events: auto; }
    .tasksTable .taskCheckbox { width: 16px; height: 16px; accent-color: var(--brand, #e2ab41); }
  `
  document.head.appendChild(style)
}

installTaskCheckboxStyleGuard()

export {}
