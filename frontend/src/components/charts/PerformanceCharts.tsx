import type { ReactNode } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts'
import { chartTooltipProps } from './chartTooltipProps'

const STATUS_BAR_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7']

const H = 280
const H_TALL = 320
/** Fixed height when fillHeight — avoids Recharts width/height -1 in flex parents */
const H_FILL = 300

function ChartShell(props: { height: number | 'fill'; children: ReactNode }) {
  if (props.height === 'fill') {
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
      <ResponsiveContainer className="rechartsFrame" width="100%" height={props.height} minWidth={0} debounce={48}>
        {props.children}
      </ResponsiveContainer>
    </div>
  )
}

export function StatusBarChart(props: { byStatus: Record<string, number>; fillHeight?: boolean }) {
  const order = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue']
  const data = order
    .filter((k) => props.byStatus[k] != null)
    .map((k) => ({ status: k.replaceAll('_', ' '), value: props.byStatus[k] || 0 }))

  return (
    <ChartShell height={props.fillHeight ? 'fill' : H}>
      <BarChart data={data}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="status" tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <YAxis tick={{ fill: 'var(--chart-tick2)', fontSize: 12 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Bar dataKey="value" name="Tasks" radius={[10, 10, 0, 0]} activeBar={false}>
          {data.map((_, i) => (
            <Cell key={`cell-${i}`} fill={STATUS_BAR_COLORS[i % STATUS_BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  )
}

export function AssigneeScoreChart(props: {
  rows: Array<{ name: string; active: number; completed: number; performanceScore: number }>
  fillHeight?: boolean
}) {
  const data = props.rows.slice(0, 10).map((r) => ({
    name: r.name,
    score: r.performanceScore,
    active: r.active,
    done: r.completed,
  }))

  return (
    <ChartShell height={props.fillHeight ? 'fill' : H_TALL}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={{ fill: 'var(--chart-tick2)', fontSize: 11 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          width={96}
          axisLine={{ stroke: 'var(--chart-axis)' }}
          tickLine={false}
        />
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Legend wrapperStyle={{ color: 'var(--text2)' }} />
        <Bar dataKey="score" name="Score" fill="#a855f7" radius={[0, 10, 10, 0]} activeBar={false} />
        <Bar dataKey="active" name="Active" fill="#38bdf8" radius={[0, 10, 10, 0]} activeBar={false} />
        <Bar dataKey="done" name="Done" fill="#22c55e" radius={[0, 10, 10, 0]} activeBar={false} />
      </BarChart>
    </ChartShell>
  )
}

export function DeadlinesTrendChart(props: { points: Array<{ day: string; due: number; overdue: number }>; fillHeight?: boolean }) {
  return (
    <ChartShell height={props.fillHeight ? 'fill' : H}>
      <LineChart data={props.points}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="day" tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <YAxis tick={{ fill: 'var(--chart-tick2)', fontSize: 11 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Legend wrapperStyle={{ color: 'var(--text2)' }} />
        <Line type="monotone" dataKey="due" name="Due" stroke="#38bdf8" strokeWidth={2.5} dot={false} activeDot={false} />
        <Line type="monotone" dataKey="overdue" name="Overdue" stroke="#f87171" strokeWidth={2.5} dot={false} activeDot={false} />
      </LineChart>
    </ChartShell>
  )
}

export function PriorityPieChart(props: { byPriority: Record<string, number>; fillHeight?: boolean }) {
  const order = ['low', 'medium', 'high', 'urgent']
  const data = order
    .filter((k) => props.byPriority[k] != null)
    .map((k) => ({ name: k, value: props.byPriority[k] || 0 }))
    .filter((x) => x.value > 0)

  const colors: Record<string, string> = {
    low: '#22d3ee',
    medium: '#818cf8',
    high: '#fbbf24',
    urgent: '#f87171',
  }

  if (data.length === 0) {
    return (
      <div
        className={props.fillHeight ? 'chartScrollFill chartEmptyCenter' : undefined}
        style={{
          height: props.fillHeight ? '100%' : H,
          minHeight: props.fillHeight ? 260 : undefined,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text2)',
          fontSize: 14,
        }}
      >
        No priority data
      </div>
    )
  }

  return (
    <ChartShell height={props.fillHeight ? 'fill' : H}>
      <PieChart>
        <Tooltip {...chartTooltipProps} cursor={false} />
        <Legend wrapperStyle={{ color: 'var(--text2)' }} />
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={92} innerRadius={54} paddingAngle={2} activeShape={false}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={colors[entry.name] || 'rgba(255,255,255,0.35)'} />
          ))}
        </Pie>
      </PieChart>
    </ChartShell>
  )
}

export function WorkloadBalanceChart(props: {
  workload: {
    averageOpenTasks: number
    overloaded: Array<{ name: string; active: number; performanceScore: number }>
    underutilized: Array<{ name: string; active: number; performanceScore: number }>
  }
  userCount: number
  fillHeight?: boolean
}) {
  const overloadedCount = props.workload?.overloaded?.length ?? 0
  const underutilizedCount = props.workload?.underutilized?.length ?? 0
  const balancedCount = Math.max(0, props.userCount - overloadedCount - underutilizedCount)
  const data = [
    { name: 'Overloaded', value: overloadedCount, color: '#f97316' },
    { name: 'Balanced', value: balancedCount, color: '#22c55e' },
    { name: 'Underutilized', value: underutilizedCount, color: '#38bdf8' },
  ]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ChartShell height={H}>
        <BarChart data={data} margin={{ bottom: 8, left: 4, right: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} />
          <YAxis tick={{ fill: 'var(--chart-tick2)', fontSize: 12 }} axisLine={{ stroke: 'var(--chart-axis)' }} tickLine={false} width={40} />
          <Tooltip {...chartTooltipProps} cursor={false} />
          <Bar dataKey="value" name="Users" radius={[10, 10, 0, 0]} activeBar={false}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartShell>
      <div style={{ display: 'grid', gap: 4, fontSize: 14, color: 'var(--text2)' }}>
        <div>Average open tasks per user: {props.workload?.averageOpenTasks?.toFixed(1) ?? '0.0'}</div>
        <div>{props.userCount} users in current scope</div>
      </div>
    </div>
  )
}
