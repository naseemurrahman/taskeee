import assert from 'node:assert/strict';

const baseUrl = (process.env.PROD_URL || process.env.VERCEL_URL || 'https://taskeee-ashen.vercel.app').replace(/\/$/, '');

const routes = [
  '/',
  '/signin',
  '/app/dashboard',
  '/app/tasks/reassignment',
  '/app/analytics',
  '/app/insights',
  '/app/reports',
  '/app/projects',
  '/app/hr/employees',
];

async function fetchRoute(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'TaskeeProductionQASmoke/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const text = await response.text();
  return { url, response, text };
}

function assertSpaShell({ url, response, text }) {
  assert.ok(response.status >= 200 && response.status < 400, `${url} returned HTTP ${response.status}`);
  assert.ok(text.includes('<!doctype html') || text.includes('<!DOCTYPE html'), `${url} did not return an HTML document`);
  assert.ok(text.includes('id="root"'), `${url} did not include the React root element`);
  assert.ok(/\/assets\/[^"']+\.(js|css)/.test(text), `${url} did not include built Vite assets`);
}

const results = [];
for (const route of routes) {
  const result = await fetchRoute(route);
  assertSpaShell(result);
  results.push({ route, status: result.response.status, bytes: result.text.length });
}

console.table(results);
console.log(`Production SPA smoke passed for ${routes.length} routes at ${baseUrl}`);
console.log('Visual QA still requires an authenticated mobile browser session for topbar, chart layout, pull-to-refresh, and theme checks.');
