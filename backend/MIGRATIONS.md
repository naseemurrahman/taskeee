# Database migrations

TaskFlow Pro now uses versioned, idempotent migrations from `backend/src/migrations/index.js`.

## Commands

```bash
npm run migrate
npm run migrate:status
```

## Runtime behavior

The API runs pending migrations during startup after the database connection is established and before schedulers start. This keeps Railway deploys safe for schema-dependent background jobs.

Legacy startup auto-migrations are disabled by default. They can be temporarily enabled only for emergency compatibility with:

```env
ENABLE_LEGACY_AUTO_MIGRATE=true
```

Do not leave legacy auto-migrations enabled permanently.

## Adding a migration

1. Add a new object to `backend/src/migrations/index.js`.
2. Use a monotonically increasing 12-digit `version`.
3. Keep statements idempotent where possible with `IF NOT EXISTS`.
4. Add rollback notes to the PR description when a migration is not easily reversible.
5. Run:

```bash
npm run validate:smoke
npm run migrate:status
```

## Rollback policy

Production rollbacks should normally restore from a Railway database backup/snapshot. Destructive migrations must be avoided unless a manual rollback plan is included in the PR.
