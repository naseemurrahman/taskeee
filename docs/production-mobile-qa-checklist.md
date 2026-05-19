# Production mobile QA checklist

Use this checklist after each production deployment that touches layout, analytics, reports, topbar, task selection, or mobile refresh behavior.

## Automated smoke check

Run from the frontend directory:

```bash
PROD_URL=https://taskeee-ashen.vercel.app npm run qa:production
```

The smoke script verifies the production SPA shell loads for the public and protected application routes. Protected application routes may redirect to sign-in, but they must still return the compiled React shell without a 4xx/5xx response.

## Manual authenticated mobile checks

Test on at least one iOS Safari device and one Android Chrome device, or equivalent browser-device emulation plus one real device.

### Topbar and themes

- Sign in and open `/app/dashboard`.
- Switch to dark theme.
- Verify these topbar actions are visible and tappable: menu, notifications, theme, language, profile.
- Switch to light theme.
- Verify the same topbar actions remain visible and tappable.
- Rotate the device once and confirm the header does not clip or overlap the content.

### Pull to refresh

- Open `/app/dashboard` on a mobile viewport.
- Scroll to the top of the content area.
- Swipe down until the pull indicator appears.
- Release after the threshold and confirm the page reloads.
- Repeat on `/app/tasks/reassignment`, `/app/analytics`, and `/app/insights`.
- Confirm the browser does not get stuck, double-refresh, or block scrolling inside scrollable panels.

### Task checkbox selection

- Open `/app/tasks/reassignment`.
- Tap a row checkbox once and confirm it selects exactly once.
- Tap it again and confirm it clears exactly once.
- Tap the select-all checkbox and confirm all visible rows select.
- Tap a normal row area and confirm it does not accidentally toggle the checkbox.

### KPI and chart layout

Check these pages at 390px, 430px, 768px, and desktop widths:

- `/app/dashboard`
- `/app/analytics`
- `/app/insights`
- `/app/reports`
- `/app/projects`
- `/app/hr/employees`

For each page:

- KPI cards must render in a readable grid, not horizontal list mode.
- No KPI card text should overflow the card boundary.
- Every chart card must show one of: live data, loading state, empty state, or error state.
- No chart should collapse to zero height.
- SVG charts must not overflow the viewport.
- Legends and labels must wrap or fit without hiding primary values.

### Terminated employee exclusion

- Mark one employee as terminated in HR.
- Refresh Dashboard, Analytics, Insights, Reports, Projects, and Employees pages.
- Confirm terminated employee data is excluded from charts, performance, workload, SLA risk, and report snapshots.
- Change the employee status back to any non-terminated status.
- Refresh the same pages and confirm that employee data appears again.

### Reports and exports

- Generate a report from `/app/reports`.
- Open the report detail page.
- Export JSON, CSV, and PDF.
- Confirm exported content includes the analytics snapshot.
- Confirm PDF includes project snapshot, department performance, employee performance, SLA risk queue, and terminated employee exclusion notice.

## Pass criteria

A deployment is production-ready only when:

- Vercel deployment is successful.
- Railway/backend validation is successful.
- `npm run qa:production` passes against the production URL.
- Manual authenticated mobile checks pass for topbar, pull-to-refresh, task checkbox behavior, KPI grids, charts, terminated employee exclusion, and report exports.
