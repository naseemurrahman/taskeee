const axios = require('axios');
const { query, withTransaction } = require('../utils/db');
const { emitNotification } = require('./notificationService');
const logger = require('../utils/logger');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';

/**
 * Sends a task payload to the AI service for approval.
 * Updates the DB with the result and notifies relevant parties.
 */
async function triggerAITaskReview(taskId) {
  logger.info(`AI task review triggered for task ${taskId}`);
  try {
    const { rows } = await query(
      `SELECT t.*, u.manager_id, u.full_name
       FROM tasks t
       JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1`,
      [taskId]
    );
    const task = rows[0];
    if (!task) return;

    const response = await axios.post(`${AI_SERVICE_URL}/api/task-review`, {
      taskId: task.id,
      title: task.title,
      description: task.description,
      notes: task.notes,
      priority: task.priority,
      dueDate: task.due_date,
      categoryId: task.category_id,
      orgId: task.org_id
    }, { timeout: 30000 });

    const { verdict, confidence = null, rejectionReason = null, modelVersion = null } = response.data || {};
    const normalized = verdict === 'approved' ? 'approved' : verdict === 'rejected' ? 'rejected' : 'manual_review';

    await withTransaction(async (client) => {
      const newTaskStatus = normalized === 'approved' ? 'ai_approved'
        : normalized === 'rejected' ? 'ai_rejected'
        : 'submitted';

      await client.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [newTaskStatus, taskId]);
      await client.query(`
        INSERT INTO task_timeline (task_id, actor_type, event_type, from_status, to_status, note, metadata)
        VALUES ($1, 'ai_system', 'ai_task_review_complete', 'ai_reviewing', $2, $3, $4)
      `, [
        taskId,
        newTaskStatus,
        `AI verdict: ${normalized}${confidence != null ? ` (confidence: ${(Number(confidence) * 100).toFixed(1)}%)` : ''}`,
        JSON.stringify({ confidence, rejectionReason, modelVersion })
      ]);
    });

    if (normalized === 'approved') {
      await emitNotification(task.assigned_to, {
        type: 'task_ai_approved',
        title: 'Task approved by AI',
        body: task.title,
        data: { taskId }
      });
      if (task.manager_id) {
        await emitNotification(task.manager_id, {
          type: 'task_ai_approved',
          title: `${task.full_name}'s task approved`,
          body: task.title,
          data: { taskId }
        });
      }
    } else if (normalized === 'rejected') {
      await emitNotification(task.assigned_to, {
        type: 'task_ai_rejected',
        title: 'Task rejected by AI',
        body: rejectionReason ? `${task.title}: ${rejectionReason}` : task.title,
        data: { taskId, reason: rejectionReason }
      });
    } else {
      if (task.manager_id) {
        await emitNotification(task.manager_id, {
          type: 'task_needs_review',
          title: 'Task needs manual review',
          body: task.title,
          data: { taskId }
        });
      }
    }

    logger.info(`AI task review complete for task ${taskId}: ${normalized}`);
  } catch (err) {
    logger.error(`AI task review failed for task ${taskId}:`, err.message);
    await query(`UPDATE tasks SET status = 'submitted' WHERE id = $1`, [taskId]);
    await query(`
      INSERT INTO task_timeline (task_id, actor_type, event_type, to_status, note)
      VALUES ($1, 'ai_system', 'ai_task_review_failed', 'submitted', 'AI service unavailable - routed to manual review')
    `, [taskId]);
  }
}

/**
 * Sends a photo to the Python AI service for inference.
 * Updates the DB with the result and notifies relevant parties.
 */
async function triggerAIReview(photoId, taskId, storageKey, categoryId) {
  logger.info(`AI review triggered for photo ${photoId}`);

  try {
    // Mark as processing
    await query(`UPDATE task_photos SET ai_status = 'processing' WHERE id = $1`, [photoId]);

    // Get category config (threshold, model)
    let aiThreshold = 0.75;
    let aiModelId = 'default_v1';

    if (categoryId) {
      const { rows } = await query(
        `SELECT ai_threshold, ai_model_id FROM task_categories WHERE id = $1`,
        [categoryId]
      );
      if (rows.length) {
        aiThreshold = rows[0].ai_threshold || 0.75;
        aiModelId = rows[0].ai_model_id || 'default_v1';
      }
    }

    // Call Python inference service
    const response = await axios.post(`${AI_SERVICE_URL}/api/review`, {
      photoId,
      storageKey,
      modelId: aiModelId,
      threshold: aiThreshold
    }, { timeout: 30000 }); // 30s timeout

    const { confidence, labels, verdict, rejectionReason, modelVersion } = response.data;
    // verdict: 'approved' | 'rejected' | 'manual_review'

    await withTransaction(async (client) => {
      const aiStatus = verdict === 'approved' ? 'approved'
        : verdict === 'rejected' ? 'rejected'
        : 'manual_review';

      await client.query(`
        UPDATE task_photos SET
          ai_status = $1, ai_confidence = $2, ai_model_version = $3,
          ai_labels = $4, ai_result_at = NOW(), ai_rejection_reason = $5
        WHERE id = $6
      `, [aiStatus, confidence, modelVersion, JSON.stringify(labels), rejectionReason, photoId]);

      // Update task status
      const newTaskStatus = verdict === 'approved' ? 'ai_approved'
        : verdict === 'rejected' ? 'ai_rejected'
        : 'submitted'; // manual_review goes back to submitted for manager

      await client.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [newTaskStatus, taskId]);

      await client.query(`
        INSERT INTO task_timeline (task_id, actor_type, event_type, from_status, to_status, note, metadata)
        VALUES ($1, 'ai_system', 'ai_review_complete', 'ai_reviewing', $2, $3, $4)
      `, [
        taskId,
        newTaskStatus,
        `AI verdict: ${verdict} (confidence: ${(confidence * 100).toFixed(1)}%)`,
        JSON.stringify({ confidence, labels, modelVersion })
      ]);
    });

    // Get task info for notifications
    const { rows: taskRows } = await query(
      `SELECT t.*, u.manager_id, u.full_name FROM tasks t
       JOIN users u ON u.id = t.assigned_to WHERE t.id = $1`,
      [taskId]
    );
    const task = taskRows[0];

    if (verdict === 'approved') {
      await emitNotification(task.assigned_to, {
        type: 'task_ai_approved',
        title: 'Task approved by AI',
        body: task.title,
        data: { taskId }
      });
      // Notify manager too
      if (task.manager_id) {
        await emitNotification(task.manager_id, {
          type: 'task_ai_approved',
          title: `${task.full_name}'s task approved`,
          body: task.title,
          data: { taskId }
        });
      }
    } else if (verdict === 'rejected') {
      await emitNotification(task.assigned_to, {
        type: 'task_ai_rejected',
        title: 'Task photo rejected',
        body: `${task.title}: ${rejectionReason}`,
        data: { taskId, reason: rejectionReason }
      });
    } else {
      // Manual review needed - notify manager
      if (task.manager_id) {
        await emitNotification(task.manager_id, {
          type: 'task_needs_review',
          title: 'Task needs manual review',
          body: task.title,
          data: { taskId, photoId }
        });
      }
    }

    logger.info(`AI review complete for task ${taskId}: ${verdict} (${confidence})`);
  } catch (err) {
    logger.error(`AI review failed for photo ${photoId}:`, err.message);

    // On failure, send to manual review
    await query(`
      UPDATE task_photos SET ai_status = 'manual_review' WHERE id = $1
    `, [photoId]);
    await query(`UPDATE tasks SET status = 'submitted' WHERE id = $1`, [taskId]);

    await query(`
      INSERT INTO task_timeline (task_id, actor_type, event_type, to_status, note)
      VALUES ($1, 'ai_system', 'ai_review_failed', 'submitted', 'AI service unavailable - routed to manual review')
    `, [taskId]);
  }
}

module.exports = { triggerAIReview, triggerAITaskReview };
