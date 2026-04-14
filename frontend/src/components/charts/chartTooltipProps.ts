/** Shared Recharts Tooltip styling: high contrast + above modals/sidebars */
export const chartTooltipProps = {
  wrapperStyle: { zIndex: 8000, outline: 'none' as const },
  contentStyle: {
    background: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-border)',
    borderRadius: 12,
    color: 'var(--text)',
    fontSize: 13,
    padding: '10px 14px',
    boxShadow: '0 14px 40px rgba(0, 0, 0, 0.12)',
  },
  labelStyle: { color: 'var(--text)', fontWeight: 800, marginBottom: 6 },
  itemStyle: { color: 'var(--text2)', paddingTop: 2 },
}
