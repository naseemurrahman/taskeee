# Next App Upgrades

## Implemented in this branch

### Professional session policy
- Frontend now treats expired access tokens as expired sessions on browser refresh.
- The app no longer silently renews an expired access token after refresh.
- Adds idle timeout and absolute session timeout guards.
- Redirects to `/signin?reason=session_expired` when the session is expired.

### 2FA/MFA reliability
- Adds auto-migrations for MFA columns and tables.
- Adds MFA recovery code table support.
- Makes MFA secret encryption resilient for test/staging by deriving from JWT secret if `MFA_ENCRYPTION_KEY` is not configured.
- Production should still configure `MFA_ENCRYPTION_KEY` explicitly.

## Next recommended upgrade: subscription enforcement

### Scope
- Enforce `subscription_status` for organization access.
- Enforce `seat_limit` when admins invite or create users.
- Show seat usage and plan status in Billing.
- Notify admins before renewal/failure/cancellation.

### Backend tasks
- Add `getOrgSubscriptionAccess(orgId)` helper.
- Add middleware for protected org subscription access.
- Add seat-limit check to user invite/create routes.
- Update Stripe webhook handlers to write organization subscription columns.

### Frontend tasks
- Billing page: current plan, subscription status, seats used, seat limit, renewal date.
- Admin warnings when plan is inactive or seat limit is reached.

## Next fixes after subscription

1. Notification deduplication and grouping
   - Repeated reminders should group by task instead of flooding the dropdown.
   - Add `dedupe_key` to notifications.

2. WhatsApp templates
   - Use approved Meta templates for production notification types.
   - Keep free-text WhatsApp only for diagnostics/testing.

3. Task templates and recurring tasks
   - Templates for onboarding, inspections, reports, and maintenance.
   - Daily/weekly/monthly recurrence.

4. Audit expansion
   - Track role changes, subscription changes, notification setting changes, test messages, task restore/delete.
