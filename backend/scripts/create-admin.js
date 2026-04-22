/* eslint-disable no-console */
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false,
});
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { resolvePgSsl } = require('../src/utils/pgSsl');

function toSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || `org-${Date.now()}`;
}

async function ensureOrg(client, companyName) {
  const { rows: found } = await client.query(
    `SELECT id, name, slug FROM organizations WHERE lower(name) = lower($1) LIMIT 1`,
    [companyName]
  );
  if (found.length) return found[0];

  let slug = toSlug(companyName);
  for (let i = 0; i < 5; i += 1) {
    try {
      const { rows } = await client.query(
        `INSERT INTO organizations (name, slug, plan, settings, is_active)
         VALUES ($1, $2, 'starter', '{}'::jsonb, true)
         RETURNING id, name, slug`,
        [companyName, slug]
      );
      return rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err;
      slug = `${toSlug(companyName)}-${Date.now().toString().slice(-5)}-${i}`;
    }
  }
  throw new Error('Could not create unique organization slug');
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const fullName = String(process.argv[3] || process.env.TF_FULL_NAME || '').trim() || email.split('@')[0] || 'Admin User';
  const companyName = String(process.argv[4] || process.env.TF_COMPANY_NAME || '').trim();
  const password = process.env.TF_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;

  if (!email || !email.includes('@')) {
    console.error('Usage: TF_PASSWORD=... node scripts/create-admin.js <email> [full-name] [company-name]');
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error('Set TF_PASSWORD to a password with at least 8 characters.');
    process.exit(1);
  }
  if (!companyName) {
    console.error('Provide company name as arg #3 or TF_COMPANY_NAME env var.');
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error('DATABASE_URL is missing.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: resolvePgSsl() });
  const hash = await bcrypt.hash(password, 12);

  await client.connect();
  try {
    await client.query('BEGIN');
    const org = await ensureOrg(client, companyName);

    const existing = await client.query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE users
         SET org_id = $1, password_hash = $2, full_name = $3, role = 'admin', is_active = true, email_verified = true
         WHERE id = $4`,
        [org.id, hash, fullName, userId]
      );
      console.log(`Updated existing user ${email} as admin in ${org.name}`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (org_id, email, password_hash, full_name, role, is_active, email_verified)
         VALUES ($1, $2, $3, $4, 'admin', true, true)
         RETURNING id`,
        [org.id, email, hash, fullName]
      );
      userId = rows[0].id;
      console.log(`Created admin user ${email} in ${org.name}`);
    }

    await client.query(
      `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
       VALUES ($1, $2, 'owner', true, NOW(), $2)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', is_active = true`,
      [org.id, userId]
    );
    await client.query('COMMIT');
    console.log(`Done. Organization: ${org.name} (${org.slug})`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
