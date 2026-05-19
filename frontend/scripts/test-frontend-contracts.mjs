import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const pathOf = (path) => resolve(root, path);
const read = (path) => readFileSync(pathOf(path), 'utf8');
const exists = (path) => existsSync(pathOf(path));

function assertContains(file, needle, message) {
  assert.ok(read(file).includes(needle), `${message}\nExpected ${file} to contain: ${needle}`);
}

function assertOptionalFileHasNoSideEffects(file) {
  if (!exists(file)) return;
  const content = read(file);
  for (const forbidden of ['MutationObserver', 'add' + 'EventListener', 'append' + 'Child', 'document.query' + 'Selector']) {
    assert.ok(!content.includes(forbidden), `${file} must remain inert and not contain ${forbidden}`);
  }
}

function testMainHasNoRuntimeSideEffectGuards() {
  const main = read('src/main.tsx');
  for (const forbidden of [
    './task-checkbox-event-guard',
    './global-search-submit',
    './employee-profile-delete-action',
    './mobile-pull-to-refresh-guard',
    './topbar-action-visibility-guard',
    './chart-render-guard',
  ]) {
    assert.ok(!main.includes(forbidden), `main.tsx must not import deprecated runtime guard ${forbidden}`);
  }
  assert.ok(main.includes("./task-checkbox.css"), 'main.tsx must load stable task checkbox CSS');
  assert.ok(main.includes("./mobile-pull-to-refresh.css"), 'main.tsx must load React pull refresh CSS');
  assert.ok(main.includes("./topbar-action-visibility.css"), 'main.tsx must load static topbar visibility CSS');
}

function testDeprecatedSideEffectModulesAreAbsentOrInert() {
  for (const file of [
    'src/task-checkbox-event-guard.ts',
    'src/global-search-submit.ts',
    'src/employee-profile-delete-action.ts',
    'src/mobile-pull-to-refresh-guard.ts',
    'src/topbar-action-visibility-guard.ts',
    'src/chart-render-guard.ts',
  ]) {
    assertOptionalFileHasNoSideEffects(file);
  }
}

function testTopbarVisibilityContracts() {
  const css = read('src/topbar-action-visibility.css');
  for (const selector of ['topbarV4MenuBtn', 'topbarNotifyBtn', 'topbarThemeBtn', 'topbarLangBtn', 'topbarV4ProfileBtn']) {
    assert.ok(css.includes(selector), `Topbar visibility CSS must cover ${selector}`);
  }
  assert.ok(css.includes('.appShellV4Light'), 'Topbar visibility CSS must include light-theme overrides');
  assert.ok(css.includes('visibility: visible'), 'Topbar visibility CSS must force action visibility');
  assert.ok(css.includes('opacity: 1'), 'Topbar visibility CSS must force action opacity');
  assert.ok(css.includes('stroke: currentColor'), 'Topbar SVG icons must inherit visible color');
  assert.ok(css.includes('-webkit-text-fill-color'), 'Topbar text/icons must remain visible in WebKit mobile browsers');
}

function testSharedAnalyticsQueryOptionsAreUsed() {
  const helper = read('src/lib/analyticsQueryOptions.ts');
  assert.match(helper, /ANALYTICS_STALE_TIME_MS\s*=\s*30_000/, 'Live analytics stale time must remain 30s');
  assert.match(helper, /ANALYTICS_REFETCH_INTERVAL_MS\s*=\s*30_000/, 'Live analytics refetch interval must remain 30s');
  assert.match(helper, /ANALYTICS_AI_STALE_TIME_MS\s*=\s*5 \* 60_000/, 'AI analytics stale time must remain 5 minutes');

  const files = [
    'src/components/dashboard/DashboardAnalyticsPanel.tsx',
    'src/components/projects/ProjectAnalyticsPanel.tsx',
    'src/components/employees/EmployeeAnalyticsPanel.tsx',
    'src/components/reports/ReportAnalyticsPanel.tsx',
    'src/pages/app/AnalyticsPage.tsx',
    'src/pages/app/InsightsPage.tsx',
  ];
  for (const file of files) {
    assertContains(file, 'liveAnalyticsQueryOptions', `${file} must use shared live analytics query options`);
  }
  assertContains('src/pages/app/AnalyticsPage.tsx', 'aiAnalyticsQueryOptions', 'AnalyticsPage must use the AI analytics query helper');
  assertContains('src/pages/app/AnalyticsPage.tsx', 'slowAnalyticsQueryOptions', 'AnalyticsPage must use the slow analytics query helper for insights');
}

function testAnalyticsPrimitiveContracts() {
  const primitives = read('src/components/analytics/AnalyticsPrimitives.tsx');
  for (const exported of ['AnalyticsCard', 'EmptyAnalyticsState', 'AnalyticsLoadingBlock', 'AnalyticsErrorNotice', 'AnalyticsRiskQueue', 'AnalyticsTrendLineChart']) {
    assert.ok(primitives.includes(`export function ${exported}`), `Analytics primitives must export ${exported}`);
  }
  for (const file of [
    'src/components/dashboard/DashboardAnalyticsPanel.tsx',
    'src/components/projects/ProjectAnalyticsPanel.tsx',
    'src/components/employees/EmployeeAnalyticsPanel.tsx',
    'src/components/reports/ReportAnalyticsPanel.tsx',
  ]) {
    const content = read(file);
    assert.ok(content.includes('AnalyticsCard'), `${file} must render shared AnalyticsCard`);
    assert.ok(content.includes('AnalyticsLoadingBlock'), `${file} must render shared loading state`);
    assert.ok(content.includes('AnalyticsErrorNotice'), `${file} must render shared error state`);
    assert.ok(content.includes('EmptyAnalyticsState') || content.includes('AnalyticsRiskQueue'), `${file} must render shared empty or risk state`);
  }
}

function testMobileResponsiveContracts() {
  const css = read('src/ui-responsive-shell.css');
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'KPI strips must use two-column grid layout on small screens');
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*grid-template-columns:\s*1fr/, 'KPI strips must collapse to one column on narrow screens');
  assertContains('src/task-checkbox.css', 'pointer-events: none', 'Task row checkboxes must avoid double toggle through CSS');
  assertContains('src/components/mobile/MobilePullToRefresh.tsx', 'REFRESH_THRESHOLD', 'Pull-to-refresh component must keep threshold-based refresh behavior');
}

function testReportSnapshotContracts() {
  assertContains('../backend/src/services/reportService.js', 'analyticsSnapshot', 'Generated reports must embed analyticsSnapshot');
  assertContains('../backend/src/services/reportSnapshotService.js', 'terminated_employee_exclusion', 'Report snapshots must record terminated employee exclusion');
  assertContains('../backend/src/routes/reports.js', 'renderReportPdf', 'PDF exports must use structured report PDF rendering');
  assertContains('../backend/src/routes/reports.js', 'SLA Risk Queue', 'PDF exports must include SLA risk queue');
  assertContains('../backend/src/routes/reports.js', 'Employee Performance', 'PDF exports must include employee performance');
}

function testEmployeeProfileActionIsComponentOwned() {
  assertContains('src/pages/app/hr/EmployeeProfilePage.tsx', 'onDeleteEmployee', 'Employee delete action must live inside EmployeeProfilePage');
  assertContains('src/pages/app/hr/EmployeeProfilePage.tsx', 'deleteM.mutate(empId)', 'Employee delete mutation must be component-owned');
}

const tests = [
  testMainHasNoRuntimeSideEffectGuards,
  testDeprecatedSideEffectModulesAreAbsentOrInert,
  testTopbarVisibilityContracts,
  testSharedAnalyticsQueryOptionsAreUsed,
  testAnalyticsPrimitiveContracts,
  testMobileResponsiveContracts,
  testReportSnapshotContracts,
  testEmployeeProfileActionIsComponentOwned,
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}

console.log(`Frontend contracts passed: ${tests.length}`);
