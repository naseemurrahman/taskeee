#!/usr/bin/env python3
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'src'

def sub_kpi_block(content: str, start_marker: str, end_marker: str, replacement: str) -> str:
    i = content.find(start_marker)
    if i < 0:
        return content
    j = content.find(end_marker, i)
    if j < 0:
        return content
    return content[:i] + replacement + content[j:]

# --- Employees ---
p = ROOT / 'pages/app/hr/EmployeesPage.tsx'
t = p.read_text(encoding='utf-8')
if 'from \'../../../components/ui/KpiCard\'' not in t:
    t = t.replace(
        "import { useToast } from '../../../components/ui/ToastSystem'",
        "import { useToast } from '../../../components/ui/ToastSystem'\nimport { KpiStrip } from '../../../components/ui/KpiCard'\nimport { Users, UserCheck, Palmtree, Building2 } from 'lucide-react'",
    )
kpi = """      <KpiStrip
        items={[
          { label: 'Total Employees', value: q.data?.total || employees.length, color: '#6366f1', icon: <Users size={36} /> },
          { label: 'Active', value: employees.filter(e => e.status === 'active').length, color: '#22c55e', icon: <UserCheck size={36} /> },
          { label: 'On Leave', value: employees.filter(e => e.status === 'on_leave').length, color: '#eab308', icon: <Palmtree size={36} /> },
          { label: 'Departments', value: new Set(employees.map(e => e.department).filter(Boolean)).size, color: '#a855f7', icon: <Building2 size={36} /> },
        ]}
      />

"""
t = sub_kpi_block(t, '      {/* KPI Cards */}', '      {/* Credentials', kpi)
p.write_text(t, encoding='utf-8')
print('Employees')

# --- CRM ---
p = ROOT / 'pages/app/crm/CrmPipelinePage.tsx'
t = p.read_text(encoding='utf-8')
if 'KpiStrip' not in t:
    t = t.replace(
        "import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'",
        "import { KpiStrip } from '../../../components/ui/KpiCard'\nimport { Briefcase, DollarSign, Layers, TrendingUp } from 'lucide-react'\nimport { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'",
    )
kpi = """      <KpiStrip
        items={[
          { label: 'Total Deals', value: deals.length, color: '#6366f1', icon: <Briefcase size={36} /> },
          { label: 'Pipeline Value', value: fmt(totalValue, 'USD'), color: '#22c55e', icon: <DollarSign size={36} />, animate: false },
          { label: 'Stages', value: stages.length, color: '#a855f7', icon: <Layers size={36} /> },
          { label: 'Avg Deal Size', value: deals.length > 0 ? fmt(totalValue / deals.length, 'USD') : '$0', color: '#eab308', icon: <TrendingUp size={36} />, animate: false },
        ]}
      />

"""
t = sub_kpi_block(t, '      {/* KPI Cards */}', '      {/* Header */}', kpi)
p.write_text(t, encoding='utf-8')
print('CRM')

# --- Billing ---
p = ROOT / 'pages/app/BillingPage.tsx'
t = p.read_text(encoding='utf-8')
if 'KpiStrip' not in t:
    t = t.replace(
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'",
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'\nimport { KpiStrip } from '../../components/ui/KpiCard'\nimport { CreditCard, CheckCircle, Users, Armchair } from 'lucide-react'",
    )
kpi = """      <KpiStrip
        items={[
          { label: 'Plan', value: sub?.plan || '—', color: '#6366f1', icon: <CreditCard size={36} />, animate: false },
          { label: 'Status', value: sub?.status || '—', color: '#22c55e', icon: <CheckCircle size={36} />, animate: false },
          { label: 'Seats', value: sub?.seats ?? '—', color: '#06b6d4', icon: <Armchair size={36} />, animate: false },
          { label: 'Active users', value: usersUsed, color: '#a855f7', icon: <Users size={36} /> },
        ]}
      />

"""
t = sub_kpi_block(t, '      <div className="grid4 kpiStripStandard">', '      <div className="card">', kpi)
p.write_text(t, encoding='utf-8')
print('Billing')

# --- Logs ---
p = ROOT / 'pages/app/LogsPage.tsx'
t = p.read_text(encoding='utf-8')
if 'KpiStrip' not in t:
    t = t.replace(
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'",
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'\nimport { KpiStrip } from '../../components/ui/KpiCard'",
    )
kpi = """      <KpiStrip
        loading={q.isLoading}
        items={[
          { label: 'Total events', value: stats.total, color: '#818cf8', icon: <IconBarChart size={36} /> },
          { label: 'Today', value: stats.today, color: '#22c55e', icon: <IconCalendar size={36} /> },
          { label: 'Logins', value: stats.logins, color: '#38bdf8', icon: <IconBarChart size={36} />, animate: false },
          { label: 'Active users', value: stats.uniqueUsers, color: '#e2ab41', icon: <IconUsers size={36} /> },
        ]}
      />

"""
t = sub_kpi_block(t, '      {/* Stats row */}', '      {/* Log table */}', kpi)
p.write_text(t, encoding='utf-8')
print('Logs')

# --- Analytics KPI strip ---
p = ROOT / 'pages/app/AnalyticsPage.tsx'
t = p.read_text(encoding='utf-8')
if 'KpiStrip' not in t:
    t = t.replace(
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'",
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'\nimport { KpiStrip } from '../../components/ui/KpiCard'",
    )
    kpi_strip = """      <KpiStrip
        loading={summaryQ.isLoading}
        skeletonCount={8}
        items={kpis.map((item) => ({
          label: item.label,
          value: item.value,
          color: item.color,
          animate: false,
          ...(item.tone ? { style: { '--kpi-color': item.color } as React.CSSProperties } : {}),
        }))}
      />

"""
    t = re.sub(
        r'      \{/\* KPI strip \*/\}\n      <div className="analyticsSignalStrip kpiStripStandard">.*?\n      </div>\n\n      \{/\* Charts grid \*/\}',
        kpi_strip + '\n      {/* Charts grid */}',
        t,
        count=1,
        flags=re.S,
    )
    p.write_text(t, encoding='utf-8')
print('Analytics')

# --- Projects ---
p = ROOT / 'pages/app/ProjectsPage.tsx'
t = p.read_text(encoding='utf-8')
if 'KpiStrip' not in t:
    t = t.replace(
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'",
        "import { PageHeaderCard } from '../../components/ui/PageHeaderCard'\nimport { KpiStrip } from '../../components/ui/KpiCard'\nimport { FolderOpen, CircleDot, ListTodo } from 'lucide-react'",
    )
    kpi = """      <KpiStrip
        items={[
          { label: 'Total Projects', value: projects.length, color: '#e2ab41', icon: <FolderOpen size={36} /> },
          { label: 'Active Projects', value: activeCount, color: '#22c55e', icon: <CircleDot size={36} /> },
          { label: 'Total Tasks', value: totalTasks, color: '#e2ab41', icon: <ListTodo size={36} /> },
        ]}
      />

"""
    t = re.sub(
        r'      <div style=\{\{ display: \'grid\', gridTemplateColumns: \'repeat\(auto-fit, minmax\(180px, 1fr\)\)\', gap: 12 \}\}>.*?</div>\n\n      <div style=\{\{ display: \'flex\', gap: 10',
        kpi + '\n      <div style={{ display: \'flex\', gap: 10',
        t,
        count=1,
        flags=re.S,
    )
    p.write_text(t, encoding='utf-8')
print('Projects')

# --- Dashboard KpiStrip ---
p = ROOT / 'pages/app/DashboardHomePage.tsx'
t = p.read_text(encoding='utf-8')
t = t.replace('import { KpiCard } from \'../../components/ui/KpiCard\'', 'import { KpiCard, KpiStrip } from \'../../components/ui/KpiCard\'')
t = t.replace('style={{ height: 30, padding: \'0 10px\', fontSize: 11 }}', 'className="btn btnGhost btnCompact"')
# Remove KpiTile wrapper
t = re.sub(r'// ─── KPI Tile.*?// ─── Main', '// ─── Main', t, flags=re.S)
dash_kpi = """      <KpiStrip
        loading={isLoading}
        skeletonCount={6}
        items={[
          { label: 'Total Tasks', value: tasks?.total || 0, color: C.brand, icon: <ClipboardList size={36} />, sub: `${tasks?.due_today || 0} due today` },
          { label: 'In Progress', value: tasks?.in_progress || 0, color: C.purple, icon: <Zap size={36} />, sub: 'active work' },
          { label: 'Completed', value: tasks?.completed || 0, color: C.green, icon: <CheckCircle2 size={36} />, sub: `${tasks?.completion_rate || 0}% rate` },
          { label: 'Overdue', value: tasks?.overdue || 0, color: C.red, icon: <AlertTriangle size={36} />, sub: `${tasks?.due_week || 0} due this week` },
          { label: 'Pending Review', value: tasks?.submitted || 0, color: C.blue, icon: <Send size={36} />, sub: 'awaiting approval' },
          { label: 'Projects', value: projects.length, color: C.teal, icon: <FolderOpen size={36} />, sub: `${projects.filter(p => p.progress === 100).length} complete` },
        ]}
      />
"""
t = re.sub(
    r'      \{/\* ── KPI Row ── \*/\}\n      <div className="dashKpiStrip kpiStripStandard">.*?</div>\n\n      \{/\* ── Row 1',
    dash_kpi + '\n\n      {/* ── Row 1',
    t,
    count=1,
    flags=re.S,
)
p.write_text(t, encoding='utf-8')
print('Dashboard')

# --- Insights: add kpiStripStandard class ---
p = ROOT / 'pages/app/InsightsPage.tsx'
t = p.read_text(encoding='utf-8')
t = t.replace('className="insightsKpiStrip"', 'className="insightsKpiStrip kpiStripStandard"')
p.write_text(t, encoding='utf-8')
print('Insights class')

# --- MyTasks: add kpiStripStandard ---
p = ROOT / 'pages/app/MyTasksPage.tsx'
t = p.read_text(encoding='utf-8')
t = t.replace('className="myTasksCommandCenter"', 'className="myTasksCommandCenter kpiStripStandard"')
p.write_text(t, encoding='utf-8')
print('MyTasks class')

print('All migrations done')
