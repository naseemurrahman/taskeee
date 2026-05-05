'use strict';

const { query, withTransaction, isDemo } = require('./db');
const logger = require('./logger');
const baseMigrations = require('../migrations');

function loadSupplementalMigrations() {
  const modules = [];
  for (const modulePath of ['../migrations/sessionManagement']) {
    try {
      const loaded = require(modulePath);
      if (Array.isArray(loaded)) modules.push(...loaded);
    } catch (err) {
      if (err?.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  return modules;
}

async function ensureMigrationsTable(clientQuery = query) {
  await clientQuery(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(clientQuery = query) {
  await ensureMigrationsTable(clientQuery);
  const { rows } = await clientQuery(`SELECT version FROM schema_migrations ORDER BY version ASC`);
  return new Set(rows.map((r) => String(r.version)));
}

function normalizeMigration(migration) {
  if (!migration || !migration.version || !migration.name || !Array.isArray(migration.up)) {
    throw new Error('Invalid migration definition. Expected version, name, and up statements.');
  }
  return {
    version: String(migration.version),
    name: String(migration.name),
    checksum: String(migration.checksum || ''),
    up: migration.up.filter(Boolean),
  };
}

function sortedMigrations() {
  return [...baseMigrations, ...loadSupplementalMigrations()]
    .map(normalizeMigration)
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function runPendingMigrations(options = {}) {
  if (isDemo && isDemo()) {
    logger.info('[migrate] Demo mode detected — skipping versioned migrations');
    return { applied: 0, skipped: true };
  }

  const all = sortedMigrations();
  let appliedCount = 0;

  await withTransaction(async (client) => {
    await ensureMigrationsTable(client.query);
    const applied = await getAppliedVersions(client.query);
    const pending = all.filter((m) => !applied.has(m.version));

    if (!pending.length) {
      if (options.verbose) logger.info('[migrate] Schema is up to date');
      return;
    }

    logger.info(`[migrate] Applying ${pending.length} pending migration(s)`);
    for (const migration of pending) {
      logger.info(`[migrate] Applying ${migration.version} ${migration.name}`);
      for (const sql of migration.up) {
        await client.query(sql);
      }
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum || null]
      );
      appliedCount += 1;
    }
  });

  logger.info(`[migrate] Versioned migrations complete: ${appliedCount} applied`);
  return { applied: appliedCount, skipped: false };
}

async function getMigrationStatus() {
  const all = sortedMigrations();
  if (isDemo && isDemo()) {
    return { applied: [], pending: all.map((m) => ({ version: m.version, name: m.name })), demo: true };
  }
  const applied = await getAppliedVersions(query);
  return {
    applied: all.filter((m) => applied.has(m.version)).map((m) => ({ version: m.version, name: m.name })),
    pending: all.filter((m) => !applied.has(m.version)).map((m) => ({ version: m.version, name: m.name })),
    demo: false,
  };
}

module.exports = { runPendingMigrations, getMigrationStatus, sortedMigrations };
