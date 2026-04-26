'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// One-time diagnostic endpoint — returns DB schema truth
router.get('/schema-check', authenticate, async (req, res) => {
  try {
    // Check task_timeline columns
    const { rows: tlCols } = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'task_timeline'
      ORDER BY ordinal_position
    `);

    // Check tasks columns  
    const { rows: taskCols } = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
      ORDER BY ordinal_position
    `);

    // Try inserting a test task_timeline row to see exact error
    let timelineTest = 'not_tested';
    try {
      await query(`SELECT 1 FROM task_timeline LIMIT 0`);
      timelineTest = 'table_exists';
    } catch (e) {
      timelineTest = `error: ${e.message}`;
    }

    // Check if tasks table has status column
    const hasStatus = taskCols.some(c => c.column_name === 'status');
    const hasOrgId = taskCols.some(c => c.column_name === 'org_id');

    res.json({
      task_timeline_columns: tlCols.map(c => c.column_name),
      tasks_has_status: hasStatus,
      tasks_has_org_id: hasOrgId,
      tasks_columns: taskCols.map(c => c.column_name),
      timeline_test: timelineTest,
      user_role: req.user.role,
      user_org_id: req.user.org_id
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
