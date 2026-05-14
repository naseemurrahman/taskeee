'use strict';

const logger = require('./logger');

function sortedMigrations() {
  return [];
}

async function runPendingMigrations(options = {}) {
  if (options.verbose) logger.info('[migrate] JS migrations disabled; use SQL file migrations only');
  return { applied: 0, skipped: true };
}

async function getMigrationStatus() {
  return { applied: [], pending: [], demo: false, source: 'disabled-js-migrations' };
}

module.exports = { runPendingMigrations, getMigrationStatus, sortedMigrations };
