export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/**
 * buildDeadlineSeries — returns daily task counts for the PAST N days.
 *
 * Each bucket contains:
 *   due:       tasks whose due_date fell on that day (any status)
 *   completed: tasks whose due_date fell on that day AND are completed/approved
 *   overdue:   tasks whose due_date fell on that day AND are still overdue/open
 *
 * Why past days? Future buckets are almost always empty because tasks are
 * created with past due dates in most workflows. Past days give real signal.
 */
export function buildDeadlineSeries(
  tasks: Array<{ due_date?: string | null; status: string }>,
  days: number,
) {
  const today = startOfDay(new Date())

  // Build buckets: past `days` days (oldest first so chart reads left→right)
  const buckets = Array.from({ length: days }, (_v, i) => {
    const day = new Date(today)
    day.setDate(today.getDate() - (days - 1 - i))   // oldest on left
    return { day, due: 0, completed: 0, overdue: 0 }
  })

  const idxByIso = new Map(buckets.map((b, i) => [startOfDay(b.day).toISOString(), i]))

  for (const t of tasks) {
    if (!t.due_date) continue
    const due  = new Date(t.due_date)
    const key  = startOfDay(due).toISOString()
    const idx  = idxByIso.get(key)
    if (idx == null) continue

    buckets[idx].due += 1

    const isDone = ['completed', 'manager_approved'].includes(t.status)
    if (isDone) {
      buckets[idx].completed += 1
    } else if (['overdue', 'pending', 'in_progress', 'submitted'].includes(t.status)) {
      buckets[idx].overdue += 1
    }
  }

  return buckets.map((b) => ({
    day:       formatDayLabel(b.day),
    due:       b.due,
    completed: b.completed,
    overdue:   b.overdue,
  }))
}

export function buildCompletedSeries(tasks: Array<{ due_date?: string | null; status: string }>, days: number) {
  const today = startOfDay(new Date())
  const buckets = Array.from({ length: days }, (_v, i) => {
    const day = new Date(today)
    day.setDate(today.getDate() - (days - 1 - i))
    return { day, completed: 0 }
  })

  const idxByIso = new Map(buckets.map((b, i) => [startOfDay(b.day).toISOString(), i]))
  for (const t of tasks) {
    if (!t.due_date) continue
    if (!['completed', 'manager_approved'].includes(t.status)) continue
    const doneDay = startOfDay(new Date(t.due_date)).toISOString()
    const idx = idxByIso.get(doneDay)
    if (idx == null) continue
    buckets[idx].completed += 1
  }
  return buckets.map((b) => ({ day: formatDayLabel(b.day), completed: b.completed }))
}
