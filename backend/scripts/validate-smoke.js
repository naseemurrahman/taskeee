'use strict';

const { cleanString, optionalUuid, enumValue, validatePagination } = require('../src/utils/validation');
const migrations = require('../src/migrations');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cleanString(' hello ', { min: 2, max: 10, field: 'name' }) === 'hello', 'cleanString trims');
assert(optionalUuid('', 'taskId') === null, 'optionalUuid accepts empty');
assert(optionalUuid('00000000-0000-4000-8000-000000000000', 'taskId'), 'optionalUuid accepts uuid');
assert(enumValue('High', ['low', 'medium', 'high'], 'priority') === 'high', 'enumValue normalizes');
const page = validatePagination({ page: '2', limit: '5' });
assert(page.offset === 5, 'pagination offset');

assert(Array.isArray(migrations) && migrations.length > 0, 'migrations are exported');
const seen = new Set();
for (const migration of migrations) {
  assert(migration.version && /^\d{12}$/.test(String(migration.version)), `invalid migration version: ${migration.version}`);
  assert(migration.name && typeof migration.name === 'string', `missing migration name: ${migration.version}`);
  assert(Array.isArray(migration.up) && migration.up.length > 0, `migration has no statements: ${migration.version}`);
  assert(!seen.has(migration.version), `duplicate migration version: ${migration.version}`);
  seen.add(migration.version);
}
const sorted = [...seen].sort();
assert(sorted.join(',') === migrations.map((m) => m.version).join(','), 'migrations must be sorted by version');

console.log('validation smoke ok');
