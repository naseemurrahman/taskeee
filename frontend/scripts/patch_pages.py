#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'src'

phc = (ROOT / 'components/ui/PageHeaderCard.tsx').read_text(encoding='utf-8')
start = phc.index('export function StatsCardGrid')
end = phc.rindex('}', len(phc) - 20) + 1
new_stats = '''export function StatsCardGrid({ stats, columns = 4 }: { stats: StatCard[]; columns?: number }) {
  return (
    <motionless
      className="kpiStripStandard"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${columns === 6 ? '160px' : columns === 4 ? '200px' : '240px'}), 1fr))`,
        gap: 12,
      }}
    >
      {stats.map((stat, i) => (
        <div
          key={i}
          className="kpiCard"
          style={{ '--kpi-color': stat.color || 'var(--primary)' } as React.CSSProperties}
        >
          <div
            className="kpiCardAccent"
            style={{ background: `linear-gradient(90deg, ${stat.color || 'var(--primary)'}, ${stat.color || 'var(--primary)'}88)` }}
          />
          {stat.icon && (
            <div className="kpiCardWatermark" style={{ color: stat.color || 'var(--muted)' }}>
              {stat.icon}
            </div>
          )}
          <div className="kpiCardLabel">{stat.label}</div>
          <div className="kpiCardValue" style={stat.color ? { color: stat.color } : undefined}>
            {stat.value}
            {stat.trend && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                marginLeft: 8,
                color: stat.trend.direction === 'up' ? '#22c55e' : stat.trend.direction === 'down' ? '#ef4444' : 'var(--muted)',
              }}>
                {stat.trend.direction === 'up' ? '↑' : stat.trend.direction === 'down' ? '↓' : '→'} {stat.trend.value}
              </span>
            )}
          </div>
          {stat.subtitle && <div className="kpiCardSub">{stat.subtitle}</div>}
        </div>
      ))}
    </div>
  )
}'''
new_stats = new_stats.replace('<motionless', '<div').replace('</motionless>', '</motionless>')
new_stats = new_stats.replace('</motionless>', '</div>', 1).replace('<motionless', '<motionless')
# clean any remaining
new_stats = new_stats.replace('motionless', 'div')
while 'divv' in new_stats:
    new_stats = new_stats.replace('divv', 'motionless')
new_stats = new_stats.replace('<div\n      className="kpiStripStandard"', '<div\n      className="kpiStripStandard"')

# Find end of StatsCardGrid function properly
import re
m = re.search(r'export function StatsCardGrid[\s\S]*?\n\}\n', phc)
if m:
    phc = phc[:m.start()] + new_stats + '\n'
    (ROOT / 'components/ui/PageHeaderCard.tsx').write_text(phc, encoding='utf-8')
    print('PageHeaderCard OK')
else:
    print('PageHeaderCard FAIL')
