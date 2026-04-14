// routes/notifications.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, unreadOnly } = req.query;
    const offset = (parseInt(page) - 1) * 30;
    let cond = 'user_id = $1';
    const params = [req.user.id];
    if (unreadOnly === 'true') cond += ' AND is_read = FALSE';
    const { rows } = await query(
      `SELECT * FROM notifications WHERE ${cond} ORDER BY created_at DESC LIMIT 30 OFFSET $2`,
      [...params, offset]
    );
    const countRes = await query(
      `SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1::uuid AND is_read = FALSE`,
      [req.user.id]
    );
    const row0 = countRes.rows[0] || {};
    const unreadCount = Number(row0.unread_count ?? row0.count ?? 0) || 0;
    res.json({ notifications: rows, unreadCount });
  } catch (err) { next(err); }
});

router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    // OWASP A01: user_id fence — can only mark own notifications
    await query(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) { next(err); }
});

router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await query(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]);
    res.json({ message: 'All marked as read' });
  } catch (err) { next(err); }
});

module.exports = router;
