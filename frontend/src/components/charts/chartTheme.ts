/** Shared palette for dashboard & analytics charts */
export const CHART = {
  brand: '#e2ab41',
  purple: '#8b5cf6',
  blue: '#38bdf8',
  green: '#22c55e',
  red: '#ef4444',
  orange: '#f97316',
  teal: '#14b8a6',
  indigo: '#6366f1',
  grid: 'rgba(148,163,184,0.18)',
  axis: { fill: 'var(--chart-tick2,#94a3b8)', fontSize: 11, fontWeight: 650 as const },
}

export const STATUS_COLORS: Record<string, string> = {
  pending: CHART.brand,
  in_progress: CHART.purple,
  submitted: CHART.blue,
  manager_approved: CHART.teal,
  completed: CHART.green,
  overdue: CHART.red,
  cancelled: '#64748b',
}

export const PRIORITY_COLORS: Record<string, string> = {
  critical: CHART.red,
  urgent: '#dc2626',
  high: CHART.orange,
  medium: CHART.purple,
  low: CHART.blue,
}
