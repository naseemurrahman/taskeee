export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

export function buildDeadlineSeries(tasks: Array<{ due_date?: string | null; status: string }>, days: number) {
  const today = startOfDay(new Date())
  const buckets = Array.from({ length: days }, (_v, i) => {
    const day = new Date(today)
    day.setDate(today.getDate() + i)
    return { day, due: 0, overdue: 0 }
  })

  const idxByIso = new Map(buckets.map((b, i) => [startOfDay(b.day).toISOString(), i]))
  const now = Date.now()

  for (const t of tasks) {
    if (!t.due_date) continue
    const due = new Date(t.due_date)
    const key = startOfDay(due).toISOString()
    const idx = idxByIso.get(key)
    if (idx == null) continue
    buckets[idx].due += 1
    const isDone = ['completed', 'manager_approved'].includes(t.status)
    if (!isDone && due.getTime() < now) buckets[idx].overdue += 1
  }

  return buckets.map((b) => ({ day: formatDayLabel(b.day), due: b.due, overdue: b.overdue }))
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
