/* eslint-disable no-console */
/**
 * Verifies DATABASE_URL and prints next steps if connection fails.
 * Run from backend folder: node scripts/test-db.js
 */
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
  override: true,
});
const { Client } = require('pg');
const { resolvePgSsl } = require('../src/utils/pgSsl');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith('#')) {
    console.error('DATABASE_URL is missing or commented out in backend/.env');
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: resolvePgSsl(),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const { rows } = await client.query('SELECT current_database() AS db, current_user AS user');
    console.log('OK — connected to PostgreSQL');
    console.log(`  database: ${rows[0].db}`);
    console.log(`  user:     ${rows[0].user}`);
    console.log('Next: npm run migrate');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Connection failed:', err.message);
    console.error('');
    console.error('Fix options:');
    console.error('  1) Docker (recommended): open Docker Desktop, then from repo root run:');
    console.error('       docker compose up -d postgres redis');
    console.error('     (matches DATABASE_URL user taskflow / db taskflow_dev / pass in .env)');
    console.error('  2) Local PostgreSQL: connect as superuser (often "postgres") and run:');
    console.error('       scripts/create-taskflow-db.sql');
    console.error('     Or set DATABASE_URL to a user/database you already have, then: npm run migrate');
    console.error('  3) Port 5432 in use? Stop the other PostgreSQL or map Docker to 5433 and set DATABASE_URL port to 5433.');
    process.exit(1);
  }
}

main();
