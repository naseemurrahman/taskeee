# Status Governance Policy

This document defines the business rules for project, task, and employee status changes in TASKEE. These rules should be treated as backend-enforced policy, not only UI behavior.

## Core principle

Entity state must be consistent across the organization. A project, task, or employee cannot be changed in isolation when that change creates impossible work states.

Examples of impossible states:

- A paused project with active tasks still moving through the workflow.
- A completed project with pending or in-progress tasks still open.
- A terminated employee still receiving new tasks.
- Active tasks remaining hidden under a deleted or inactive assignee without a reassignment queue.

## Roles and authority

### Admin and Director

Admin and Director can perform governance overrides, but overrides must remain auditable. They may complete a project while active tasks exist only when an override reason is provided.

### HR

HR can manage employee lifecycle status and can manage task/project state only within normal governance constraints. HR cannot override project completion with active tasks unless explicitly promoted to Admin or Director policy authority.

### Manager and Supervisor

Managers and Supervisors can manage operational task flow and assignment for their scope, but they cannot bypass lifecycle consistency. They cannot make tasks active under paused/completed projects, and they cannot assign work to inactive employees.

### Employee and Technician

Employees and Technicians can only operate on their own assigned tasks and cannot change project or employee lifecycle state.

## Project status policy

### Active

An active project can receive new tasks. Its tasks can move through the normal workflow.

When a project is reactivated, tasks that were put on hold by the project pause may be restored to `pending` only if their assignee is still active.

### Paused

A paused project is temporarily stopped. Active project tasks must move to `on_hold` so they are visible but cannot continue normal workflow.

Allowed task changes under a paused project:

- Move to `on_hold`.
- Move to `cancelled`.

Blocked task changes under a paused project:

- `pending`
- `in_progress`
- `submitted`
- `manager_approved`
- `completed`

### Completed

A completed project is closed. It cannot receive new tasks. Existing active tasks must be resolved before completion.

Normal completion requires no active tasks. If active tasks exist, only Admin or Director may complete with an override reason. Active tasks should not remain active after the project is completed.

## Task status policy

A task is governed by both its own status and the status of its parent project.

Task status changes must check:

1. The user has permission to change task status.
2. The task's project is active, unless the change is a safe pause/cancel action.
3. The assignee is active if the target status represents active work.
4. Dependency rules are satisfied for non-override transitions.

## Employee lifecycle policy

### Active

An active employee can receive tasks and can continue assigned work.

### Inactive, Suspended, On Leave

The employee account should be deactivated or treated as unavailable for assignment. Active assigned tasks should move to `on_hold` and be visible in the reassignment queue.

### Terminated or Deleted

The employee account must be deactivated. Assigned active tasks must be moved to `on_hold` and flagged for reassignment. Tasks should not be deleted automatically because they represent business work that may still need completion.

## Reassignment policy

Tasks needing reassignment are tasks that meet any of these conditions:

- Status is `on_hold` due to employee lifecycle change.
- Assignee user is inactive.
- Linked employee record is inactive, suspended, on leave, terminated, or deleted.

Managers, HR, Directors, and Admins should have a dedicated view for these tasks.

## Backend architecture rule

Do not rely on frontend-only enforcement. The frontend should guide the user, but backend routes must be the source of truth.

Status-governance checks should run before legacy route handlers so unsafe requests fail before data is mutated.

Current implementation:

- `backend/src/routes/statusGovernance.js` defines governance overlays.
- `backend/src/server.js` mounts these overlays before the legacy project, task, and HRIS route handlers.

## Required regression tests

Add or maintain tests for these cases:

1. Pausing a project moves active project tasks to `on_hold`.
2. Reactivating a project restores held tasks only when assignees are active.
3. Completing a project with active tasks fails without override.
4. Completing a project with override is limited to Admin/Director and requires a reason.
5. Task status cannot move to active workflow states while project is paused/completed.
6. Inactive or terminated employees do not appear in assignable-user lists.
7. Task creation and reassignment fail when the target employee is inactive or terminated.
8. Employee termination/deletion moves active tasks to the reassignment queue instead of deleting them.
9. Paused and completed projects are visible in project filters/tabs.
