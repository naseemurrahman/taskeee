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

async function fetchUrl(url, accept = '*/*') {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'TaskeeProductionQASmoke/1.0',
      accept,
    },
  });
  const text = await response.text();
  return { url, response, text };
}

async function fetchRoute(path) {
  return fetchUrl(`${baseUrl}${path}`, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
}

function assertSpaShell({ url, response, text }) {
  assert.ok(response.status >= 200 && response.status < 400, `${url} returned HTTP ${response.status}`);
  assert.ok(text.includes('<!doctype html') || text.includes('<!DOCTYPE html'), `${url} did not return an HTML document`);
  assert.ok(text.includes('id="root"'), `${url} did not include the React root element`);
  assert.ok(/\/assets\/[^"']+\.(js|css)/.test(text), `${url} did not include built Vite assets`);
}

function uniqueAssetUrls(html) {
  const matches = html.matchAll(/["'](\/assets\/[^"']+\.(?:js|css))["']/g);
  return [...new Set([...matches].map(match => `${baseUrl}${match[1]}`))];
}

async function fetchAssetsFromShell(html) {
  const urls = uniqueAssetUrls(html);
  assert.ok(urls.length > 0, 'Production shell did not expose any Vite assets');
  const assets = [];
  for (const url of urls) {
    const asset = await fetchUrl(url);
    assert.ok(asset.response.status >= 200 && asset.response.status < 400, `${url} returned HTTP ${asset.response.status}`);
    assert.ok(asset.text.length > 100, `${url} appears too small to be a compiled asset`);
    assets.push(asset);
  }
  return assets;
}

function assertCompiledAssetContracts(assets) {
  const css = assets.filter(asset => asset.url.endsWith('.css')).map(asset => asset.text).join('\n');
  const js = assets.filter(asset => asset.url.endsWith('.js')).map(asset => asset.text).join('\n');
  const all = `${css}\n${js}`;

  const cssContracts = [
    'taskeePullRefreshIndicator',
    'topbarV4MenuBtn',
    'topbarNotifyBtn',
    'topbarThemeBtn',
    'topbarLangBtn',
    'topbarV4ProfileBtn',
    'taskCheckbox',
    'kpiStripStandard',
  ];
  for (const signature of cssContracts) {
    assert.ok(css.includes(signature), `Compiled CSS is missing ${signature}`);
  }

  const jsContracts = [
    'MobilePullToRefresh',
    'Release to refresh',
    'Pull to refresh',
    'liveAnalyticsQueryOptions',
    'analyticsSnapshot',
  ];
  for (const signature of jsContracts) {
    assert.ok(all.includes(signature), `Compiled assets are missing ${signature}`);
  }
}

const results = [];
let firstHtml = '';
for (const route of routes) {
  const result = await fetchRoute(route);
  assertSpaShell(result);
  if (!firstHtml) firstHtml = result.text;
  results.push({ route, status: result.response.status, bytes: result.text.length });
}

const assets = await fetchAssetsFromShell(firstHtml);
assertCompiledAssetContracts(assets);

console.table(results);
console.table(assets.map(asset => ({ asset: asset.url.replace(baseUrl, ''), status: asset.response.status, bytes: asset.text.length })));
console.log(`Production SPA smoke passed for ${routes.length} routes at ${baseUrl}`);
console.log('Compiled asset contracts passed for topbar, pull-to-refresh, task checkboxes, KPI grid, analytics query helpers, and report snapshots.');
console.log('Visual QA still requires an authenticated mobile browser session for topbar, chart layout, pull-to-refresh, and theme checks.');
