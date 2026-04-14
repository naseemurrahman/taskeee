const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');
const axios = require('axios');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// GET /insights - Generate AI insights for the organization
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { timeRange = '30d', insightTypes = 'productivity,bottlenecks,predictions,recommendations' } = req.query;
    const orgId = req.user.org_id || req.user.orgId;
    
    // Fetch tasks for the organization
    const { rows: tasks } = await query(`
      SELECT 
        t.id,
        t.title,
        t.status,
        t.priority,
        t.assigned_to,
        u.full_name as assigned_to_name,
        t.due_date,
        t.created_at,
        t.completed_at,
        u.department,
        (SELECT COUNT(*) FROM task_dependencies td WHERE td.task_id = t.id) as dependency_count
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.org_id = $1 
      AND t.created_at >= NOW() - INTERVAL '90 days'
      ORDER BY t.created_at DESC
    `, [orgId]);
    
    if (!tasks.length) {
      return res.json({
        insights: { message: 'No task data available for analysis' },
        generatedAt: new Date().toISOString(),
        timeRange,
        taskCount: 0
      });
    }
    
    // Prepare data for AI service
    const taskData = tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignedTo: task.assigned_to,
      assignedToName: task.assigned_to_name,
      dueDate: task.due_date,
      createdAt: task.created_at,
      completedAt: task.completed_at,
      department: task.department,
      dependencyCount: parseInt(task.dependency_count) || 0
    }));
    
    // Call AI service for insights
    try {
      const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/insights`, {
        tasks: taskData,
        timeRange,
        insightTypes: insightTypes.split(',')
      }, {
        timeout: 15000, // 15 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      res.json(aiResponse.data);
      
    } catch (aiError) {
      console.error('AI Service error:', aiError.message);
      
      // Fallback to basic insights if AI service is unavailable
      const fallbackInsights = generateFallbackInsights(taskData);
      
      res.json({
        insights: fallbackInsights,
        generatedAt: new Date().toISOString(),
        timeRange,
        taskCount: taskData.length,
        fallback: true,
        message: 'AI service unavailable, showing basic analytics'
      });
    }
    
  } catch (error) {
    console.error('Insights generation error:', error);
    next(error);
  }
});

// Fallback insights generation when AI service is unavailable
function generateFallbackInsights(tasks) {
  const completed = tasks.filter(t => ['completed', 'manager_approved', 'ai_approved'].includes(t.status));
  const pending = tasks.filter(t => !['completed', 'cancelled'].includes(t.status));
  const overdue = tasks.filter(t => {
    if (!t.dueDate || ['completed', 'cancelled'].includes(t.status)) return false;
    return new Date(t.dueDate) < new Date();
  });
  
  // Department performance
  const deptStats = {};
  tasks.forEach(task => {
    const dept = task.department || 'Unassigned';
    if (!deptStats[dept]) {
      deptStats[dept] = { total: 0, completed: 0 };
    }
    deptStats[dept].total++;
    if (['completed', 'manager_approved', 'ai_approved'].includes(task.status)) {
      deptStats[dept].completed++;
    }
  });
  
  // Status distribution
  const statusCounts = {};
  tasks.forEach(task => {
    statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
  });
  
  return {
    productivity: {
      overall_completion_rate: tasks.length > 0 ? (completed.length / tasks.length * 100).toFixed(1) : 0,
      total_completed: completed.length,
      total_tasks: tasks.length,
      department_performance: deptStats
    },
    bottlenecks: {
      status_distribution: statusCounts,
      overdue_count: overdue.length,
      pending_count: pending.length
    },
    recommendations: {
      recommendations: [
        ...(overdue.length > 0 ? [{
          type: 'deadline',
          priority: 'high',
          title: 'Overdue Tasks',
          description: `${overdue.length} tasks are overdue and need attention`,
          action: 'Review and reprioritize overdue tasks'
        }] : []),
        ...(pending.length > tasks.length * 0.7 ? [{
          type: 'workload',
          priority: 'medium',
          title: 'High Pending Workload',
          description: `${((pending.length / tasks.length) * 100).toFixed(1)}% of tasks are still pending`,
          action: 'Consider resource allocation or deadline adjustments'
        }] : [])
      ]
    }
  };
}

module.exports = router;
