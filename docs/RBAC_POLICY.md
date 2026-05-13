# TASKEE RBAC Policy

This document records the backend authorization model introduced for the enterprise RBAC hardening phase.

## Role hierarchy

Authority increases left to right:

`employee < technician < supervisor < manager < hr < director < admin`

## Scope model

| Scope | Meaning |
| --- | --- |
| `self` | The signed-in user can access only their own profile/tasks/notifications. |
| `team` | The signed-in user can access their own records and direct/indirect reports from `get_subordinate_ids()`. |
| `org` | The signed-in user can access records across the current `org_id`. |

## Role permissions

| Role | Scope | Primary permissions |
| --- | --- | --- |
| Employee | self | Own profile, own tasks, own time-off requests, own search. |
| Technician | self | Same as employee. |
| Supervisor | team | Team task visibility, team task updates/deletes, project read, employee-team read, team search. |
| Manager | team/org mixed | Team task management, bulk task status updates, project create/update, team employee visibility, team user creation. |
| HR | org | Org task visibility, employee lifecycle management, org user read/create, time-off management, people search. |
| Director | org | HR permissions plus reports, audit read, AI governance. |
| Admin | org/system | Full org administration, settings, integrations, billing, RBAC management. |

## Field-level protection

The centralized RBAC utility defines sensitive user and employee fields. Sensitive employee fields include compensation, metadata, phone, personal identifiers, banking fields, and salary. Sensitive user fields include password/MFA/temp-password fields, notification preferences, and private contact fields.

Routes should sanitize sensitive fields unless the actor has the relevant permission, such as `employees:read:sensitive` or `users:read:org`.

## Search visibility rules

Global search must not bypass RBAC:

- Employee/technician: own task and notification search only.
- Supervisor/manager: own + subordinate task search, team people search.
- HR/director/admin: organization-level people and task search.
- Reports require `reports:read:org`.
- Project search requires project organization-level read/update permission.

## Implementation reference

- `backend/src/security/rbac.js` contains the canonical role hierarchy, permission matrix, helper checks, scope labels, and field sanitizers.
- `backend/src/middleware/auth.js` delegates role hierarchy and org-wide role decisions to the centralized policy.
- `backend/src/middleware/taskAccessPolicy.js` enforces task collection access via permissions instead of duplicated role lists.
- `backend/src/routes/search.js` applies RBAC scope to result categories and returns the actor search scope in response metadata.
