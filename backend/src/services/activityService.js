const { query } = require('../utils/db');
const logger = require('../utils/logger');

async function logUserActivity({ orgId, userId, taskId = null, activityType, metadata = {} }) {
  if (!orgId || !userId || !activityType) return;
  try {
    await query(
      `INSERT INTO user_activity_logs (org_id, user_id, task_id, activity_type, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, userId, taskId, activityType, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    logger.warn(`Activity log failed: ${err.message}`);
  }
}

module.exports = { logUserActivity };
