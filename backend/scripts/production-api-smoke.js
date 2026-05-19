'use strict';

const assert = require('assert/strict');

const rawBaseUrl = process.env.API_URL || process.env.PROD_API_URL || process.env.RAILWAY_PUBLIC_URL || '';
const baseUrl = rawBaseUrl.replace(/\/$/, '');

if (!baseUrl) {
  console.log('API_URL was not provided; skipping production API smoke test.');
  process.exit(0);
}

const checks = [
  { path: '/', expectJson: true, expectStatus: 200, fields: ['status'] },
  { path: '/health', expectJson: true, expectStatus: 200, fields: ['status', 'checks', 'timestamp'] },
  { path: '/api/v1/health', expectJson: true, expectStatus: 200, fields: ['status', 'checks', 'timestamp'] },
  { path: '/api/v1/insights/overview', expectJson: true, expectStatus: 200, fields: ['generated_at', 'insights'] },
];

async function fetchCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'TaskeeProductionAPISmoke/1.0',
      accept: 'application/json,*/*;q=0.8',
    },
  });

  const text = await response.text();
  assert.equal(response.status, check.expectStatus, `${url} returned HTTP ${response.status}: ${text.slice(0, 160)}`);

  let body = null;
  if (check.expectJson) {
    assert.match(response.headers.get('content-type') || '', /json/i, `${url} did not return JSON content-type`);
    body = JSON.parse(text);
    for (const field of check.fields || []) {
      assert.ok(Object.prototype.hasOwnProperty.call(body, field), `${url} JSON is missing field ${field}`);
    }
  }

  return { path: check.path, status: response.status, bytes: text.length, body };
}

const results = [];
for (const check of checks) {
  results.push(await fetchCheck(check));
}

const health = results.find(result => result.path === '/api/v1/health')?.body || {};
assert.ok(['ok', 'starting'].includes(String(health.status)), `Unexpected health status: ${health.status}`);
assert.ok(health.checks && typeof health.checks === 'object', 'Health payload must include checks object');

console.table(results.map(result => ({ path: result.path, status: result.status, bytes: result.bytes })));
console.log(`Production API smoke passed for ${checks.length} endpoints at ${baseUrl}`);
