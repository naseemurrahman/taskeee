const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { triggerAIReview } = require('../services/aiService');
const { emitNotification } = require('../services/notificationService');
const { assertAllowedFile, multerFileFilter } = require('../utils/fileSecurity');

// Only load AWS SDK if S3 is properly configured
let S3Client, PutObjectCommand, GetObjectCommand, getSignedUrl;
let s3 = null;

if (process.env.S3_BUCKET && process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID) {
  try {
    ({ S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'));
    ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    s3 = new S3Client({ region: process.env.AWS_REGION });
  } catch (e) {
    console.warn('S3 not available:', e.message);
  }
}

const skipS3 = () => process.env.DEMO_MODE === 'true' || !process.env.S3_BUCKET || !s3;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: multerFileFilter
});

function uploadEvidence(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) return next(err);
    if (req.file) return next();
    upload.single('file')(req, res, next);
  });
}

/** Roles that can upload to any task in their org without being the assignee */
const MANAGER_UPLOAD_ROLES = new Set(['supervisor', 'manager', 'hr', 'director', 'admin']);

function isManagerRole(role) {
  return MANAGER_UPLOAD_ROLES.has(String(role || '').toLowerCase());
}

// POST /photos/upload — images (AI review) or PDF/Excel evidence (stored, no AI vision)
//
// Two upload paths depending on role:
//
//   Employee (assignee only):
//     - Must be the assigned_to user on the task
//     - Task status auto-changes: images → ai_reviewing, docs → submitted
//     - AI review triggered for images
//
//   Manager / Admin / HR / Director / Supervisor:
//     - Can upload to ANY task in their org (no assigned_to constraint)
//     - Task status is NOT mutated (managers add context, not submit work)
//     - AI review NOT triggered
//     - Assignee is notified
//
router.post('/upload', authenticate, uploadEvidence, async (req, res, next) => {
  try {
    const { taskId, takenAt, geoLat, geoLng } = req.body;
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });
    if (!req.file) return res.status(400).json({ error: 'file is required (field name: photo or file)' });

    assertAllowedFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    });

    const uploaderIsManager = isManagerRole(req.user.role);

    let taskRows;
    if (uploaderIsManager) {
      // Managers can upload to any non-deleted task in their org
      const { rows } = await query(`
        SELECT * FROM tasks
        WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
      `, [taskId, req.user.org_id]);
      taskRows = rows;
    } else {
      // Employees must own the task and it must be in a submittable state
      const { rows } = await query(`
        SELECT * FROM tasks
        WHERE id = $1 AND org_id = $2 AND assigned_to = $3
          AND status IN ('pending', 'in_progress', 'submitted', 'ai_rejected')
      `, [taskId, req.user.org_id, req.user.id]);
      taskRows = rows;
    }

    if (!taskRows.length)
      return res.status(403).json({ error: uploaderIsManager ? 'Task not found' : 'Task not found or not submittable' });

    const task = taskRows[0];
    const photoId = uuidv4();
    const mime = req.file.mimetype.toLowerCase();
    const isImage = mime.startsWith('image/');

    let ext = (req.file.originalname || 'file').split('.').pop() || 'bin';
    if (ext.length > 8) ext = isImage ? 'jpg' : 'pdf';
    const storageKey = `orgs/${req.user.org_id}/tasks/${taskId}/evidence/${photoId}.${ext}`;
    const bucket = process.env.S3_BUCKET || 'demo-local';

    if (!skipS3()) {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: { taskId, uploadedBy: req.user.id, orgId: req.user.org_id }
      }));
    }

    const photo = await withTransaction(async (client) => {
      const { rows: photoRows } = await client.query(`
        INSERT INTO task_photos
          (id, task_id, uploaded_by, storage_key, storage_bucket,
           file_size_bytes, mime_type, original_filename, taken_at, geo_lat, geo_lng)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
      `, [photoId, taskId, req.user.id, storageKey, bucket,
          req.file.size, req.file.mimetype, req.file.originalname,
          takenAt || null, geoLat || null, geoLng || null]);

      if (uploaderIsManager) {
        // ── Manager upload: store file + timeline, NEVER mutate task status ──
        await client.query(`
          UPDATE task_photos SET ai_status = 'manager_attachment', ai_confidence = NULL WHERE id = $1
        `, [photoId]);
        await client.query(`
          INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note)
          VALUES ($1, $2, 'user', 'manager_attachment', $3)
        `, [taskId, req.user.id, `Attachment added by manager: ${req.file.originalname}`]);
      } else if (isImage) {
        // ── Employee image: trigger AI review, set status to ai_reviewing ──
        await client.query(`
          UPDATE tasks SET status = 'ai_reviewing', submitted_at = NOW() WHERE id = $1
        `, [taskId]);
        await client.query(`
          INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, from_status, to_status, note)
          VALUES ($1, $2, 'user', 'photo_uploaded', $3, 'ai_reviewing', 'Photo submitted for AI review')
        `, [taskId, req.user.id, task.status]);
      } else {
        // ── Employee document: set status to submitted ──
        await client.query(`
          UPDATE task_photos SET ai_status = 'document', ai_confidence = NULL WHERE id = $1
        `, [photoId]);
        await client.query(`
          UPDATE tasks SET status = 'submitted', submitted_at = NOW() WHERE id = $1
        `, [taskId]);
        await client.query(`
          INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, from_status, to_status, note)
          VALUES ($1, $2, 'user', 'document_uploaded', $3, 'submitted', $4)
        `, [taskId, req.user.id, task.status, `Evidence file uploaded: ${req.file.originalname}`]);
      }

      return photoRows[0];
    });

    // ── Build notification recipient set ─────────────────────────────────────
    const notifyIds = new Set();

    if (uploaderIsManager) {
      // Manager uploaded — notify the assignee so they know context was added
      if (task.assigned_to && task.assigned_to !== req.user.id) notifyIds.add(task.assigned_to);
    } else {
      // Employee uploaded — notify assignor/manager as before
      if (task.assigned_by && task.assigned_by !== req.user.id) notifyIds.add(task.assigned_by);
      const { rows: managerRows } = await query(
        `SELECT id, manager_id FROM users WHERE id = ANY($1::uuid[])`,
        [[req.user.id, task.assigned_to].filter(Boolean)]
      );
      for (const row of managerRows) {
        if (row?.manager_id && row.manager_id !== req.user.id) notifyIds.add(row.manager_id);
      }
    }

    // ── Manager upload — return immediately after storing (no AI review) ─────
    if (uploaderIsManager) {
      for (const uid of notifyIds) {
        await emitNotification(uid, {
          type: 'task_attachment_uploaded',
          title: 'Attachment added by manager',
          body: `${req.file.originalname} — ${task.title}`,
          data: { taskId, uploadedBy: req.user.id, kind: isImage ? 'image' : 'document' }
        });
      }
      return res.status(201).json({
        photo: { id: photo.id, taskId, status: 'manager_attachment' },
        message: 'File attached. Task status unchanged.'
      });
    }

    // ── Employee image path ───────────────────────────────────────────────────
    if (isImage) {
      triggerAIReview(photo.id, taskId, storageKey, task.category_id).catch(
        err => console.error('AI review trigger failed:', err)
      );
      for (const uid of notifyIds) {
        await emitNotification(uid, {
          type: 'task_attachment_uploaded',
          title: 'Task attachment uploaded',
          body: `${req.file.originalname} — ${task.title}`,
          data: { taskId, uploadedBy: req.user.id, kind: 'image' }
        });
      }
      return res.status(201).json({
        photo: { id: photo.id, taskId, status: 'ai_reviewing' },
        message: 'Photo uploaded. AI review in progress.'
      });
    }

    for (const uid of notifyIds) {
      await emitNotification(uid, {
        type: 'task_evidence_uploaded',
        title: 'Task evidence submitted',
        body: `${req.file.originalname} — ${task.title}`,
        data: { taskId, uploadedBy: req.user.id }
      });
    }

    return res.status(201).json({
      photo: { id: photo.id, taskId, status: 'submitted' },
      message: 'Document stored. Relevant reviewers were notified.'
    });
  } catch (err) { next(err); }
});

router.get('/:id/url', authenticate, async (req, res, next) => {
  try {
    if (skipS3()) {
      return res.json({ url: null, expiresIn: 0, demo: true, message: 'File URLs unavailable in demo mode without S3' });
    }
    const { rows } = await query(`
      SELECT tp.*, t.org_id FROM task_photos tp
      JOIN tasks t ON t.id = tp.task_id
      WHERE tp.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });
    if (rows[0].org_id !== req.user.org_id)
      return res.status(403).json({ error: 'Access denied' });

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: rows[0].storage_bucket,
      Key: rows[0].storage_key
    }), { expiresIn: 3600 });

    res.json({ url, expiresIn: 3600 });
  } catch (err) { next(err); }
});

router.post('/:id/review', authenticate, async (req, res, next) => {
  try {
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ error: 'Decision must be approved or rejected' });

    const { rows } = await query(`
      SELECT tp.*, t.assigned_to, t.assigned_by, t.org_id
      FROM task_photos tp JOIN tasks t ON t.id = tp.task_id
      WHERE tp.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });
    if (rows[0].org_id !== req.user.org_id)
      return res.status(403).json({ error: 'Access denied' });

    await withTransaction(async (client) => {
      await client.query(`
        UPDATE task_photos SET ai_status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
        WHERE id = $4
      `, [decision, req.user.id, note, req.params.id]);

      const newTaskStatus = decision === 'approved' ? 'manager_approved' : 'ai_rejected';
      await client.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [newTaskStatus, rows[0].task_id]);

      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, to_status, note)
        VALUES ($1, $2, 'user', 'manual_review', $3, $4)
      `, [rows[0].task_id, req.user.id, newTaskStatus, note || `Manual ${decision}`]);
    });

    res.json({ message: `Photo ${decision} manually` });
  } catch (err) { next(err); }
});

module.exports = router;
