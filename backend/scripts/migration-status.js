'use strict';

require('dotenv').config();
const logger = require('../src/utils/logger');
const { connectDB } = require('../src/utils/db');
const { getMigrationStatus } = require('../src/utils/migrationRunner');

async function main() {
  await connectDB();
  const status = await getMigrationStatus();
  logger.info(`[migrate] Applied: ${status.applied.length}`);
  logger.info(`[migrate] Pending: ${status.pending.length}`);
  if (status.pending.length) {
    for (const migration of status.pending) logger.info(`[migrate] pending ${migration.version} ${migration.name}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.error('Migration status failed:', error);
  process.exit(1);
});
