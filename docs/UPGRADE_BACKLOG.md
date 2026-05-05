# Upgrade Backlog

## Active issues

### 1. Session renews after browser refresh

**Status:** Open

**Problem**
When a user's access token/session expires, refreshing the browser tab can renew the session without requiring a fresh sign-in.

**Risk**
This weakens session-expiry enforcement, especially when the user expects expiry to force re-authentication.

**Likely cause**
The frontend keeps the refresh token in localStorage and automatically calls `/api/v1/auth/refresh` after a 401. If the refresh token is still valid, the app silently issues a new access token.

**Recommended fix**
- Decide the product policy:
  - Option A: allow silent refresh while the refresh token is valid.
  - Option B: force sign-in after access-token expiry or after a shorter absolute session lifetime.
- For stricter session security:
  - Move refresh tokens out of localStorage into `httpOnly`, `Secure`, `SameSite` cookies.
  - Add an absolute session max age.
  - Add refresh-token rotation and reuse detection.
  - Add a `rememberMe` mode if long sessions are desired.
  - Clear auth and redirect to `/signin` when refresh is rejected.

**Priority:** High before production.

---

## Next upgrades

### 2. Stripe subscription enforcement and seat limits

**Status:** Next recommended implementation

**Scope**
- Use the organization subscription columns already added by migrations.
- Enforce `subscription_status` on protected app access.
- Enforce `seat_limit` when admins invite/create users.
- Add billing alerts for failed payment, canceled subscription, and period ending.

**Backend work**
- Update billing webhook handlers to write:
  - `stripe_customer_id`
  - `stripe_subscription_id`
  - `subscription_plan`
  - `subscription_status`
  - `current_period_end`
  - `cancel_at_period_end`
  - `seat_limit`
  - `billing_email`
- Add helper: `getOrgSubscriptionAccess(orgId)`.
- Add seat check before creating/inviting users.

**Frontend work**
- Improve billing page to show plan status, seats used, seats allowed, next renewal, and warnings.

**Priority:** High.

---

### 3. WhatsApp template messaging

**Status:** Planned

**Scope**
- Keep free-text WhatsApp for diagnostics/testing.
- Use approved Meta templates for production notifications.

**Suggested env vars**
- `WHATSAPP_TEMPLATE_TASK_ASSIGNED`
- `WHATSAPP_TEMPLATE_TASK_OVERDUE`
- `WHATSAPP_TEMPLATE_PAYMENT_SUCCESS`
- `WHATSAPP_TEMPLATE_LANGUAGE`

**Priority:** High for production WhatsApp.

---

### 4. Notification deduplication and grouping

**Status:** Planned

**Problem**
Repeated reminders can flood the notification dropdown.

**Recommended fix**
- Deduplicate similar reminder notifications within a configurable time window.
- Group reminders by task.
- Add a `dedupe_key` column to `notifications`.
- Update existing notification if the dedupe key exists instead of inserting another duplicate.

**Priority:** Medium-high.

---

### 5. Task templates and recurring tasks

**Status:** Planned

**Scope**
- Task templates for onboarding, inspections, reports, maintenance, and client workflows.
- Recurring task rules: daily, weekly, monthly, custom.
- Auto-create next task based on schedule.

**Priority:** Medium.

---

### 6. Full audit trail improvements

**Status:** Planned

**Scope**
Audit these actions:
- User created/deactivated
- Role changed
- Subscription changed
- Payment failed
- Task deleted/restored
- Notification settings changed
- WhatsApp/email test sent

**Priority:** Medium.
