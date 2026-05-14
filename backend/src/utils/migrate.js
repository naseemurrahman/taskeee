/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
  override: true,
});

const { Client } = require('pg');
const { resolvePgSsl } = require('./pgSsl');

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function run() {
  const connectionString = process.env.DATABASE_URL;
  console.log('[migrate] Starting migration runner...');
  if (!connectionString) {
    console.error('[migrate] ERROR: Missing DATABASE_URL. Cannot run migrations.');
    process.exitCode = 1;
    return;
  }
  console.log('[migrate] DATABASE_URL found, connecting...');

  // Railway Postgres URLs include ?sslmode=require&channel_binding=require
  // which conflicts with passing a separate ssl:{} object to node-postgres.
  // Strip those params and let pgSsl.js handle SSL to avoid ECONNRESET errors.
  const cleanUrl = connectionString
    .replace(/[?&]sslmode=[^&]*/g, '')
    .replace(/[?&]channel_binding=[^&]*/g, '')
    .replace(/\?$/, '')
    .replace(/[?&]$/, '');

  const client = new Client({
    connectionString: cleanUrl,
    ssl: resolvePgSsl(),
  });

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Found ${files.length} migration files.`);

  try {
    await client.connect();
  } catch (err) {
    console.error('[migrate] FAILED to connect to Postgres.');
    console.error(`[migrate] Error: ${err.message}`);
    console.error(`[migrate] Code: ${err.code}`);
    process.exitCode = 1;
    return;
  }
  try {
    // Ensure required extensions and migrations table exist (auto-commit, no transaction needed)
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows: appliedRows } = await client.query(`SELECT filename FROM schema_migrations`);
    const applied = new Set(appliedRows.map(r => r.filename));

    // If DB was initialized by docker-entrypoint-initdb.d (or a manual SQL import),
    // tables may exist but schema_migrations will be empty. Baseline by inspection
    // so we don't try to re-run 001_initial_schema.sql.
    if (applied.size === 0) {
      const hasOrganizations = await tableExists(client, 'organizations');
      if (hasOrganizations) {
        const sentinelByFile = new Map([
          ['001_initial_schema.sql', 'organizations'],
          ['001_task_messages.sql', 'task_messages'],
          ['002_seed_dev.sql', 'organizations'],
          ['003_work_management_features.sql', 'task_dependencies'],
          ['004_integrations.sql', 'integrations'],
          ['005_multi_org.sql', 'organization_members'],
          ['006_auth_tokens_mfa.sql', 'email_verification_tokens'],
          ['007_stripe_billing.sql', 'stripe_subscriptions'],
          ['008_org_plan_check.sql', 'organizations'],
          ['009_platform_primitives.sql', 'audit_logs'],
          ['010_hris.sql', 'employees'],
          ['011_crm.sql', 'crm_pipelines'],
          ['012_contractors.sql', 'contractors'],
          ['013_users_avatar_text.sql', 'users'],
          ['014_dev_seed_login_fix.sql', 'users'],
        ]);

        let baselined = 0;
        for (const file of files) {
          const sentinel = sentinelByFile.get(file);
          if (!sentinel) continue;
          if (await tableExists(client, sentinel)) {
            await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
            applied.add(file);
            baselined++;
          }
        }
        if (baselined > 0) {
          console.log(`Baselined ${baselined} existing migrations from current database state.`);
        }
      }
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`- Skipping ${file} (already applied)`)
        continue
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      console.log(`- Applying ${file}`)
      // Each file gets its own transaction so a slow/failing migration
      // doesn't block or roll back all others
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file])
        await client.query('COMMIT')
      } catch (fileErr) {
        await client.query('ROLLBACK')
        console.error(`[migrate] FAILED ${file}: ${fileErr.message}`)
        // Mark as failed but continue — server will start in degraded mode
        process.exitCode = 1
      }
    }

    console.log('[migrate] All migrations complete.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null)
    console.error('Migration setup failed:', err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

run();

