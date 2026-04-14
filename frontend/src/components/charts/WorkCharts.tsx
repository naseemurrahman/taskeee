import type { ReactNode } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts'
import { chartTooltipProps } from './chartTooltipProps'

const VIVID = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#3b82f6']
const H = 280
const H_FILL = 300

function withAlpha(hex: string, alpha: string) {
  if (hex.startsWith('#') && hex.length === 7) return `${hex}${alpha}`
  return hex
}

function ChartShell(props: { fillHeight?: boolean; children: ReactNode }) {
  if (props.fillHeight) {
    return (
      <div className="chartScroll">
        <ResponsiveContainer className="rechartsFrame" width="100%" height={H_FILL} minWidth={0} debounce={56}>
          {props.children}
        </ResponsiveContainer>
      </div>
    )
  }
  return (
    <div className="chartScroll">
      <ResponsiveContainer className="rechartsFrame" width="100%" height={H} minWidth={0} debounce={48}>
        {props.children}
      </ResponsiveContainer>
    </div>
  )
}

export function ProjectProgressChart(props: { rows: Array<{ name: string; done: number; remaining: number }>; fillHeight?: boolean }) {
  const data = props.rows.slice(0, 10)
  return (
    <ChartShell fillHeight={props.fillHeight}>
      <BarChart data={data} margin={{ bottom: 8, left: 4, right: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--chart-tick)', fontSize: 10 }}
          axisLine={{ stroke: 'var(--chart-axis)' }}
          tickLine={false}
          interval={0}
          angle={-22}
          textAnchor="end"
          height={48}
        />
        <YAxis tick={{ fill: 'var(--chart-tick2)', fontSize: 11 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} width={36} />
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Legend wrapperStyle={{ color: 'var(--text2)' }} />
        <Bar dataKey="done" name="Done" stackId="a" radius={[10, 10, 0, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`d-${i}`} fill={VIVID[i % VIVID.length]} />
          ))}
        </Bar>
        <Bar dataKey="remaining" name="Remaining" stackId="a" radius={[10, 10, 0, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`r-${i}`} fill={withAlpha(VIVID[i % VIVID.length], '55')} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  )
}

export function AssignmentsChart(props: { rows: Array<{ name: string; active: number; overdue: number; done: number }>; fillHeight?: boolean }) {
  const data = props.rows.slice(0, 10)
  return (
    <ChartShell fillHeight={props.fillHeight}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={{ fill: 'var(--chart-tick2)', fontSize: 11 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} width={96} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Legend wrapperStyle={{ color: 'var(--text2)' }} />
        <Bar dataKey="active" name="Active" stackId="a" radius={[0, 10, 10, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`a-${i}`} fill={withAlpha(VIVID[i % VIVID.length], 'cc')} />
          ))}
        </Bar>
        <Bar dataKey="overdue" name="Overdue" stackId="a" radius={[0, 10, 10, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`o-${i}`} fill="#f87171" />
          ))}
        </Bar>
        <Bar dataKey="done" name="Done" stackId="a" radius={[0, 10, 10, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`dn-${i}`} fill="#4ade80" />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  )
}
