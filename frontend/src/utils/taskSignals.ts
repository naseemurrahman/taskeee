export type SignalLevel = 'low' | 'medium' | 'high' | 'critical'

export type TaskSignal = {
  score: number
  level: SignalLevel
  needsAttention: boolean
  note: string
  loadNote?: string
}

type SignalTask = {
  status?: string | null
  priority?: string | null
  due_date?: string | null
  assigned_to?: string | null
}

export function buildTaskSignal(task: SignalTask, loadByUser: Map<string, number>): TaskSignal {
  const status = String(task.status || '').toLowerCase()
  if (['completed', 'manager_approved', 'cancelled'].includes(status)) {
    return { score: 5, level: 'low', needsAttention: false, note: 'No immediate action needed.' }
  }

  let score = 10
  const timestamp = task.due_date ? new Date(task.due_date).getTime() : null
  const days = timestamp ? Math.ceil((timestamp - Date.now()) / 86400000) : null

  if (days !== null && days < 0) score += 50
  else if (days !== null && days <= 2) score += 25
  else if (days !== null && days <= 5) score += 15

  const priority = String(task.priority || '').toLowerCase()
  if (['critical', 'urgent'].includes(priority)) score += 25
  else if (priority === 'high') score += 15
  else if (priority === 'medium') score += 5

  const currentLoad = task.assigned_to ? loadByUser.get(task.assigned_to) || 0 : 0
  if (currentLoad >= 10) score += 20
  else if (currentLoad >= 8) score += 15
  else if (currentLoad >= 6) score += 8

  if (!task.assigned_to) score += 20

  const finalScore = Math.min(100, Math.round(score))
  const level: SignalLevel = finalScore >= 85 ? 'critical' : finalScore >= 65 ? 'high' : finalScore >= 40 ? 'medium' : 'low'
  const loadNote = task.assigned_to && currentLoad >= 8 ? `High current load (${currentLoad} open tasks)` : undefined

  let note = 'Monitor in normal planning.'
  if (!task.assigned_to) note = 'Assign an owner to reduce follow-up risk.'
  else if (days !== null && days < 0) note = 'Review today; deadline has already passed.'
  else if (currentLoad >= 8) note = 'Review owner capacity before adding more work.'
  else if (days !== null && days <= 2) note = 'Confirm progress today and clear blockers.'
  else if (finalScore >= 40) note = 'Check priority, due date, and owner capacity.'

  return { score: finalScore, level, needsAttention: finalScore >= 65, note, loadNote }
}

export function signalBadgeClass(level: SignalLevel) {
  return `aiRiskBadge aiRiskBadge${level.charAt(0).toUpperCase()}${level.slice(1)}`
}
