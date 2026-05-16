# Revert Log - April 26, 2026

## Operation: Revert commits from April 24-26, 2026

This branch contains the revert of all 30 commits made during the period April 24-26, 2026.

### Commits Reverted (in reverse chronological order):

1. `9e225ce` - Codex - docs: add rollback notes for Apr 26 branch revoke request
2. `0eadd2f` - Codex - chore(git): revoke Apr 26 pushes on work/main branches
3. `78871d5` - Claude - fix(definitive): bypass all middleware complexity with simple direct endpoints
4. `9dafed2` - Claude - fix(root-cause): DB schema mismatch causing all writes to fail silently
5. `7c4209d` - Claude - fix(critical): task creation + status change + board DnD all fixed
6. `7253d29` - Claude - fix: status change critical fix — timeline INSERT was rolling back status UPDATE
7. `c82665f` - Codex - Fix RBAC role matrix for task create and status changes
8. `c8986a9` - Codex - Restore full-card dragging on board tasks
9. `dda1a84` - Codex - Fix board drag target and restore analytics RBAC export
10. `2931c63` - naseemurrahman - Fix drag permissions for task status changes
11. `1bb7107` - naseemurrahman - Refactor RBAC functions for improved role handling
12. `2401fc5` - Claude Fix - fix: add technician role + fix board drag for admin/manager/hr
13. `c23cf02` - Claude Fix - fix(board): complete drag-and-drop rewrite
14. `5f15855` - Claude Fix - fix: proper drag and drop with optimistic updates and stale closure fix
15. `eb26131` - Claude Fix - fix: remove stopPropagation from card drag events to fix board drag and drop
16. `9bb51e3` - Codex - Handle board drops on card surfaces as well as columns
17. `ad4543f` - Claude - fix: status change and board DnD — definitive fix
18. `356734e` - Claude - fix: board DnD working, status change working, transitions for all roles
19. `7cc0c94` - Claude - merge
20. `b5abe7d` - Claude - fix: board DnD, tasks status dropdown, backend status permissions
21. `d01e287` - Codex - Add pointer-event fallback for board drag and drop
22. `694e90e` - Codex - Restore card-level drop handlers for reliable board DnD
23. `51579891` - Codex - Normalize role checks in frontend RBAC helpers
24. `b32e6b2` - Codex - Normalize user roles in auth middleware checks
25. `719eb7a` - Codex - Simplify drag click suppression without timeouts
26. `e391409` - Codex - Improve board drag leave and click suppression
27. `783f618` - Codex - Fix board drag-and-drop column drop handling
28. `86259d0` - Codex - Add dedicated board-status endpoint for reliable board updates
29. `32dae97` - Codex - Add board quick-move fallback control for status updates
30. `7e830f5` - Codex - Harden board drag drop with dataTransfer fallback lookup

### Previous State (Base Commit):

`36a0edcf` - Before April 24, 2026

### How to Use This Branch:

1. Review the changes on this branch via PR
2. Once approved, merge to main
3. All 30 commits will be undone
4. Backup branch: `taskee-backup` (points to main before reverts)

### Revert Date: 2026-04-26
