const cron = require('node-cron');
const { query } = require('../utils/db');
const { runHierarchicalReports } = require('./reportService');
const { emitNotification } = require('./notificationService');
const logger = require('../utils/logger');

const noProgressSent = new Set();
const atRiskSent = new Set();

async function runDueRecurringTasks() {
  try {
    const { rows: orgs } = await query(`SELECT id FROM organizations WHERE is_active = TRUE`);
    const { generateDueRules } = require('../routes/recurringTasks');
    for (const org of orgs) {
      const generated = await generateDueRules(org.id, null).catch(err => {
        logger.warn(`Recurring task generation failed for org ${org.id}: ${err.message}`);
        return [];
      });
      if (generated.length) logger.info(`Generated ${generated.length} recurring task(s) for org ${org.id}`);
    }
  } catch (e) {
    logger.warn('Recurring task scheduler: ' + e.message);
  }
}

async function runScheduledDigests() {
  try {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const { rows: prefs } = await query(`
      SELECT ndp.*, u.full_name, u.email
        FROM notification_digest_preferences ndp
        JOIN users u ON u.id = ndp.user_id
       WHERE ndp.is_enabled = TRUE
         AND ndp.frequency <> 'off'
         AND ndp.delivery_hour = $1
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND (ndp.frequency = 'daily' OR ($2::int = 1 AND ndp.frequency = 'weekly'))
    `, [hour, day]);

    for (const pref of prefs) {
      const periodStart = pref.frequency === 'weekly'
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const { rows: existing } = await query(
        `SELECT 1 FROM notification_digest_runs
          WHERE user_id = $1 AND frequency = $2 AND period_start::date = $3::date AND period_end::date = $4::date
          LIMIT 1`,
        [pref.user_id, pref.frequency, periodStart.toISOString(), now.toISOString()]
      ).catch(() => ({ rows: [] }));
      if (existing.length) continue;

      const { rows: taskRows } = await query(`
        SELECT
          COUNT(*) FILTER (WHERE t.due_date::date = CURRENT_DATE AND COALESCE(t.status,'pending') NOT IN ('completed','manager_approved','cancelled'))::int AS due_today,
          COUNT(*) FILTER (WHERE t.due_date < NOW() AND COALESCE(t.status,'pending') NOT IN ('completed','manager_approved','cancelled'))::int AS overdue,
          COUNT(*) FILTER (WHERE COALESCE(t.status,'pending') IN ('completed','manager_approved') AND t.updated_at >= $3)::int AS completed
        FROM tasks t
        WHERE t.org_id = $1
          AND (t.assigned_to = $2 OR t.assigned_by = $2)
          AND COALESCE(t.deleted_at IS NULL, TRUE)
      `, [pref.org_id, pref.user_id, periodStart.toISOString()]).catch(() => ({ rows: [{}] }));
      const summary = taskRows[0] || {};
      const title = pref.frequency === 'weekly' ? 'Weekly task digest' : 'Daily task digest';
      const body = `${summary.due_today || 0} due today · ${summary.overdue || 0} overdue · ${summary.completed || 0} completed`;

      await emitNotification(pref.user_id, {
        type: 'notification_digest',
        title,
        body,
        data: { frequency: pref.frequency, summary },
        dedupeKey: `digest:${pref.user_id}:${pref.frequency}:${periodStart.toISOString().slice(0, 10)}:${now.toISOString().slice(0, 10)}`,
      });

      await query(
        `INSERT INTO notification_digest_runs (org_id, user_id, frequency, period_start, period_end, channel, summary, status)
         VALUES ($1,$2,$3,$4,$5,'in_app',$6::jsonb,'sent')
         ON CONFLICT DO NOTHING`,
        [pref.org_id, pref.user_id, pref.frequency, periodStart.toISOString(), now.toISOString(), JSON.stringify(summary)]
      ).catch(() => null);
    }
  } catch (e) {
    logger.warn('Notification digest scheduler: ' + e.message);
  }
}

function start() {
  // Recurring task generation: every hour
  cron.schedule('5 * * * *', runDueRecurringTasks);

  // Notification digests: hourly, respects per-user delivery hour
  cron.schedule('15 * * * *', runScheduledDigests);

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

module.exports = { start, runDueRecurringTasks, runScheduledDigests };
