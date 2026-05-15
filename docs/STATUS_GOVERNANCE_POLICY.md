# Status Governance Policy

This document defines the application rules for project, task, and employee status changes in TASKEE. These rules must be enforced by backend routes, not only by UI controls.

## Core rule

Entity state must remain consistent across the organization. A change to one entity must not leave related records in an impossible workflow state.

Examples:

- A paused project must not have tasks moving through normal active workflow.
- A completed project must not keep unresolved active tasks.
- A non-active employee must not receive new work assignments.
- Tasks assigned to unavailable employees must be visible for reassignment.

## Authority model

Admin and Director can perform audited governance overrides. HR can manage employee lifecycle state and standard task/project operations. Manager and Supervisor can manage normal operational task flow within scope. Employee and Technician can operate only on their own assigned work.

## Project statuses

### Active

Active projects can receive tasks. Related tasks may move through the normal workflow.

### Paused

Paused projects stop normal task progress. Active related tasks should move to `on_hold`. While paused, only safe task moves such as `on_hold` or `cancelled` should be allowed.

### Completed

Completed projects are closed. They cannot receive new tasks. Completion should require all active work to be resolved unless Admin or Director supplies an auditable override reason.

## Task status policy

Task status changes must check user permission, project status, assignee availability, and dependency constraints before mutation.

## Employee lifecycle policy

Active employees can receive work. Non-active employees cannot receive new assignments. Existing active tasks for unavailable employees should move to `on_hold` and appear in a reassignment queue.

## Reassignment policy

Tasks need reassignment when they are on hold due to employee availability or when their assignee is no longer active. Managers, HR, Directors, and Admins should have a dedicated reassignment view.

## Backend architecture rule

The backend is the source of truth. Frontend controls may guide the user, but all critical status and assignment rules must be enforced before legacy route handlers mutate data.

Current implementation:

- `backend/src/routes/statusGovernance.js` defines governance overlays.
- `backend/src/server.js` mounts these overlays before legacy project, task, and HRIS routes.

## Required regression tests

1. Pausing a project moves active project tasks to `on_hold`.
2. Reactivating a project restores held tasks only when assignees are active.
3. Completing a project with active tasks fails without override.
4. Completion override is limited to Admin or Director and requires a reason.
5. Task status cannot move to active workflow states while the project is paused or completed.
6. Non-active employees do not appear in assignable-user lists.
7. Task creation and reassignment fail when the target employee is non-active.
8. Employee lifecycle changes move active tasks to the reassignment queue.
9. Paused and completed projects are visible in project filters.
