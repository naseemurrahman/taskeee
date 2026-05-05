'use strict';

const { cleanString, optionalUuid, enumValue, validatePagination } = require('../src/utils/validation');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cleanString(' hello ', { min: 2, max: 10, field: 'name' }) === 'hello', 'cleanString trims');
assert(optionalUuid('', 'taskId') === null, 'optionalUuid accepts empty');
assert(optionalUuid('00000000-0000-4000-8000-000000000000', 'taskId'), 'optionalUuid accepts uuid');
assert(enumValue('High', ['low', 'medium', 'high'], 'priority') === 'high', 'enumValue normalizes');
const page = validatePagination({ page: '2', limit: '5' });
assert(page.offset === 5, 'pagination offset');

console.log('validation smoke ok');
