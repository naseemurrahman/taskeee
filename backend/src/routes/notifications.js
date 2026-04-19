// routes/notifications.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');

let notificationsColumnSet = null;

async function getNotificationsColumns() {
  if (notificationsColumnSet) return notificationsColumnSet;
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications'`
  );
  notificationsColumnSet = new Set(rows.map((r) => String(r.column_name)));
  return notificationsColumnSet;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const cols = await getNotificationsColumns();
    const hasIsRead = cols.has('is_read');

    const pageNum = Number.parseInt(String(req.query?.page ?? '1'), 10);
    const safePage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
    const offset = (safePage - 1) * 30;

    const whereParts = ['user_id = $1'];
    if (hasIsRead && req.query?.unreadOnly === 'true') whereParts.push('is_read = FALSE');

    const { rows } = await query(
      `SELECT * FROM notifications
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 30 OFFSET $2`,
      [req.user.id, offset]
    );

    let unreadCount = 0;
    if (hasIsRead) {
      const countRes = await query(
        `SELECT COUNT(*)::int AS unread_count
           FROM notifications
          WHERE user_id = $1 AND is_read = FALSE`,
        [req.user.id]
      );
      const row0 = countRes.rows[0] || {};
      unreadCount = Number(row0.unread_count ?? row0.count ?? 0) || 0;
    }

    res.json({ notifications: rows, unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const cols = await getNotificationsColumns();
    if (!cols.has('is_read')) {
      return res.json({ message: 'Read state is not supported in this database schema' });
    }

    const setReadAt = cols.has('read_at') ? ', read_at = NOW()' : '';
    await query(
      `UPDATE notifications
          SET is_read = TRUE${setReadAt}
        WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
});

router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    const cols = await getNotificationsColumns();
    if (!cols.has('is_read')) {
      return res.json({ message: 'Read state is not supported in this database schema' });
    }

    const setReadAt = cols.has('read_at') ? ', read_at = NOW()' : '';
    await query(
      `UPDATE notifications
          SET is_read = TRUE${setReadAt}
        WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
