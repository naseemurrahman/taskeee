# Chart/Data Audit and Stabilization Plan

## Goal

Every chart and analytics card must be live, scoped, and explainable:

- No hardcoded chart values.
- No frontend-only business calculations where an API should own the metric.
- No blank chart cards without a loading, empty, or error state.
- Terminated employees must be excluded from normal dashboards, analytics, performance, reports, and chart APIs.
- Audit/admin history pages may add an explicit include-terminated option later, but normal operational views should not include terminated employees.

## Current status

### Backend analytics foundation

The analytics backend now exposes live endpoints for core charts:

- `/api/v1/analytics/summary`
- `/api/v1/analytics/task-status`
- `/api/v1/analytics/tasks-over-time`
- `/api/v1/analytics/employee-performance`
- `/api/v1/analytics/workload`
- `/api/v1/analytics/priority-breakdown`
- `/api/v1/analytics/completion-time`
- `/api/v1/analytics/overdue-trend`
- `/api/v1/analytics/ai-validation`
- `/api/v1/analytics/ai-confidence`

These endpoints apply organization/user scope and non-terminated employee filtering through the employee visibility utility.

### Pages already partially migrated

| Page | Status | Notes |
|---|---|---|
| Analytics | Mostly migrated | Uses backend summary, status, trend, priority, employee performance, and workload APIs. Remaining AI/action cards still derive some recommendations client-side as fallback text. |
| Insights | Migrated for live data | Uses backend summary/status/trend/priority/workload and task fallback for project/category breakdown. Mobile chart layout still requires component-level cleanup beyond CSS patches. |
| Dashboard | Needs audit | Confirm all chart data comes from `/stats/dashboard` or analytics endpoints, not local inference. |
| Reports | Needs unification | Report generation should use the same analytics service methods as charts so report totals match dashboard/analytics totals. |
| Employees | Needs audit | Employee profile/performance widgets should use backend analytics, not local task counting. |
| Projects | Needs audit | Project charts should move to project analytics endpoints; avoid deriving progress from partially loaded frontend rows. |

## Required backend endpoints still recommended

Add or verify these APIs before replacing the remaining frontend calculations:

1. `GET /api/v1/analytics/project-summary`
   - project/category id, name, total tasks, completed, open, overdue, completion rate, earliest due date.

2. `GET /api/v1/analytics/project-trend`
   - full generated date series per project/category for created/completed/overdue.

3. `GET /api/v1/analytics/department-performance`
   - department, employee count, assigned, completed, overdue, completion rate, workload pressure.

4. `GET /api/v1/analytics/employee-trend`
   - employee-level date series for assigned/completed/overdue.

5. `GET /api/v1/analytics/sla-risk`
   - tasks due soon, overdue, high-risk priority, stalled pending tasks, review backlog.

6. `GET /api/v1/reports/:id/analytics-snapshot`
   - normalized chart payload used by report detail/PDF views.

## Frontend chart requirements

Every chart component should support these states explicitly:

```ts
type ChartState<T> = {
  loading: boolean
  error?: unknown
  data: T
  emptyTitle?: string
  emptyDetail?: string
}
```

Required behavior:

- `loading`: skeleton or shimmer, never a blank card.
- `error`: clear retryable error state.
- `empty`: clear no-data message for the selected period.
- `data`: render only after container has valid data.

## Chart implementation guidance

Prefer backend data contracts shaped directly for chart consumption. Avoid these patterns:

- `tasks.slice(...).reduce(...)` inside page components for production chart values.
- Deriving org-wide analytics from paginated frontend task lists.
- Assuming a full date series exists on the frontend.
- Rendering legends when the chart body is empty.
- Using runtime DOM guards as the primary fix for chart layout.

Acceptable frontend-only calculations:

- Formatting labels.
- Calculating percentages from backend-provided numerator/denominator in the same payload.
- Sorting/display slicing for UI presentation.
- Fallback empty-state summaries.

## Tests added

Backend tests now cover:

- Employee visibility SQL excludes `terminated` status.
- Candidate user filtering respects active/non-terminated employee visibility.
- Manager scoping filters self plus subordinates.
- Org-wide scoping filters all non-terminated users.
- Analytics summary applies non-terminated assigned-user filters.
- Tasks-over-time returns a generated date series and uses correct source dates.
- Priority breakdown is backend-generated.
- Employee analytics are personal for manager/supervisor roles unless org-wide.

## Next implementation sequence

1. Audit Dashboard, Reports, Employees, and Projects pages for frontend chart calculations.
2. Add missing analytics endpoints listed above.
3. Replace frontend-derived chart payloads with backend payloads.
4. Add reusable chart state wrappers.
5. Remove or minimize CSS/runtime guards after component-level fixes are complete.
6. Add viewport regression tests for 360, 390, 430, 768, 1024, and desktop widths.
7. Add integration tests for every analytics endpoint with active and terminated employees in the same org.

## Definition of done

A page is considered complete only when:

- All chart values come from backend APIs.
- The chart remains readable at 360px width.
- Loading, empty, and error states are visible.
- Terminated employee data is excluded.
- The same numbers appear in charts, reports, and exports for the same scope and date range.
