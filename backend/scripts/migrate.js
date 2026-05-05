'use strict';

require('dotenv').config();
const logger = require('../src/utils/logger');
const { connectDB } = require('../src/utils/db');
const { runPendingMigrations, getMigrationStatus } = require('../src/utils/migrationRunner');

async function runMigrations() {
  logger.info('Starting versioned database migrations...');
  await connectDB();
  const before = await getMigrationStatus().catch(() => null);
  if (before && before.pending?.length) {
    logger.info(`[migrate] Pending migrations: ${before.pending.map((m) => m.version).join(', ')}`);
  }
  const result = await runPendingMigrations({ verbose: true });
  const after = await getMigrationStatus().catch(() => null);
  logger.info(`[migrate] Completed. Applied this run: ${result.applied || 0}. Remaining pending: ${after?.pending?.length ?? 'unknown'}`);
  return result;
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigrations };
