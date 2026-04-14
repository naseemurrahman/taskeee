const cron = require('node-cron');
const { query } = require('../utils/db');
const { runHierarchicalReports } = require('./reportService');
const { emitNotification } = require('./notificationService');
const logger = require('../utils/logger');

const noProgressSent = new Set();
const atRiskSent = new Set();

function start() {
  // Daily report: every day at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    logger.info('Running daily reports...');
    const { rows: orgs } = await query(`SELECT id FROM organizations WHERE is_active = TRUE`);
    for (const org of orgs) {
      await runHierarchicalReports(org.id, 'daily').catch(err =>
        logger.error(`Daily report failed for org ${org.id}:`, err.message)
      );
    }
  });

  // Weekly report: every Monday at 8:00 AM
  cron.schedule('0 8 * * 1', async () => {
    logger.info('Running weekly reports...');
    const { rows: orgs } = await query(`SELECT id FROM organizations WHERE is_active = TRUE`);
    for (const org of orgs) {
      await runHierarchicalReports(org.id, 'weekly').catch(err =>
        logger.error(`Weekly report failed for org ${org.id}:`, err.message)
      );
    }
  });

  // Overdue detection: every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Checking for overdue tasks...');
    const { rows: overdue } = await query(`
      UPDATE tasks SET status = 'overdue'
      WHERE due_date < NOW()
        AND status NOT IN ('completed','cancelled','overdue')
      RETURNING id, assigned_to, title, org_id
    `);

    for (const task of overdue) {
      await query(`
        INSERT INTO task_timeline (task_id, actor_type, event_type, to_status, note)
        VALUES ($1, 'system', 'task_overdue', 'overdue', 'Task automatically marked overdue')
      `, [task.id]);
    }

    if (overdue.length > 0) {
      logger.info(`Marked ${overdue.length} tasks as overdue`);
    }
  });

  // Upcoming deadline warnings: every hour
  cron.schedule('10 * * * *', async () => {
    try {
      const { rows } = await query(`
        SELECT id, title, assigned_to, due_date
        FROM tasks
        WHERE due_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
          AND status NOT IN ('completed','cancelled','overdue')
      `);
      const hourKey = new Date().toISOString().slice(0, 13);
      for (const task of rows) {
        const dedupe = `${task.id}_${hourKey}`;
        if (atRiskSent.has(dedupe)) continue;
        atRiskSent.add(dedupe);
        await emitNotification(task.assigned_to, {
          type: 'task_deadline_at_risk',
          title: 'Task deadline approaching',
          body: task.title,
          data: { taskId: task.id, dueDate: task.due_date }
        });
      }
    } catch (e) {
      logger.warn('Deadline warning scheduler: ' + e.message);
    }
  });

  // No progress (24h) reminders — every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { rows } = await query(`
        SELECT t.id, t.title, t.assigned_to, t.assigned_by, u.manager_id
        FROM tasks t
        JOIN users u ON u.id = t.assigned_to
        WHERE t.status IN ('pending','in_progress')
          AND COALESCE(t.updated_at, t.created_at) < NOW() - INTERVAL '24 hours'
      `);

      const dayKey = new Date().toISOString().slice(0, 10);
      for (const task of rows) {
        const dedupe = `${task.id}_${dayKey}`;
        if (noProgressSent.has(dedupe)) continue;
        noProgressSent.add(dedupe);

        await emitNotification(task.assigned_to, {
          type: 'task_no_progress',
          title: 'Reminder: task waiting for progress',
          body: task.title,
          data: { taskId: task.id }
        });
        if (task.manager_id) {
          await emitNotification(task.manager_id, {
            type: 'task_no_progress_manager',
            title: 'Follow-up: no progress on task',
            body: task.title,
            data: { taskId: task.id }
          });
        }
      }
    } catch (e) {
      logger.warn('No-progress scheduler: ' + e.message);
    }
  });

  logger.info('Scheduler started');
}

module.exports = { start };
