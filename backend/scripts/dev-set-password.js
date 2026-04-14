/**
 * Set password + email_verified for a user (local/dev only).
 * Password is read from env TF_PASSWORD — never pass on the command line or commit it.
 *
 * Usage (PowerShell):
 *   $env:TF_PASSWORD = 'your-secret-password'
 *   node scripts/dev-set-password.js you@email.com
 *
 * If no user exists, creates one in the first active organization (admin role).
 */
/* eslint-disable no-console */
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
  override: true,
});
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { resolvePgSsl } = require('../src/utils/pgSsl');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const password = process.env.TF_PASSWORD;
  const fullName = String(process.env.TF_FULL_NAME || '').trim() || email.split('@')[0] || 'User';

  if (!email || !email.includes('@')) {
    console.error('Usage: TF_PASSWORD=... node scripts/dev-set-password.js user@email.com');
    console.error('Optional: TF_FULL_NAME="Your Name" when creating a new user');
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error('Set TF_PASSWORD to a password with at least 8 characters.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is missing in backend/.env');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const client = new Client({
    connectionString: url,
    ssl: resolvePgSsl(),
  });

  await client.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE users SET password_hash = $1, email_verified = true WHERE lower(trim(email)) = $2`,
      [hash, email]
    );

    if (rowCount > 0) {
      console.log(`Updated password and email_verified for ${email}`);
      return;
    }

    const { rows: orgs } = await client.query(
      `SELECT id FROM organizations WHERE is_active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (!orgs.length) {
      console.error('No organization found. Create one via signup or run migrations.');
      process.exit(1);
    }

    const orgId = orgs[0].id;
    const ins = await client.query(
      `INSERT INTO users (org_id, email, password_hash, full_name, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, 'admin', true, true)
       RETURNING id`,
      [orgId, email, hash, fullName]
    );
    const userId = ins.rows[0].id;
    console.log(`Created user ${email} (admin) in org ${orgId}`);
    try {
      await client.query(
        `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
         VALUES ($1, $2, 'owner', true, NOW(), $2)
         ON CONFLICT (org_id, user_id) DO UPDATE SET is_active = true`,
        [orgId, userId]
      );
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
