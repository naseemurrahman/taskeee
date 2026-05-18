const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');
const advancedAnalyticsService = require('../services/advancedAnalyticsService');
const { authenticate, requireAnyRole } = require('../middleware/auth');

const ANALYTICS_ROLES = ['employee', 'hr', 'manager', 'supervisor', 'director', 'admin'];

function filtersFromQuery(req) {
  return {
    from: req.query.from,
    to: req.query.to,
    days: req.query.days,
    employeeId: req.query.employeeId,
    projectId: req.query.projectId,
  };
}

function analyticsHandler(methodName, service = analyticsService) {
  return async (req, res, next) => {
    try {
      const data = await service[methodName](req.user, filtersFromQuery(req));
      res.json(data);
    } catch (err) {
      next(err);
    }
  };
}

router.use(authenticate, requireAnyRole(...ANALYTICS_ROLES));

router.get('/summary', analyticsHandler('getSummary'));
router.get('/task-status', analyticsHandler('getTaskStatus'));
router.get('/tasks-over-time', analyticsHandler('getTasksOverTime'));
router.get('/employee-performance', analyticsHandler('getEmployeePerformance'));
router.get('/ai-validation', analyticsHandler('getAiValidation'));
router.get('/ai-confidence', analyticsHandler('getAiConfidence'));
router.get('/workload', analyticsHandler('getWorkload'));
router.get('/completion-time', analyticsHandler('getCompletionTime'));
router.get('/overdue-trend', analyticsHandler('getOverdueTrend'));
router.get('/priority-breakdown', analyticsHandler('getPriorityBreakdown'));

router.get('/project-summary', analyticsHandler('getProjectSummary', advancedAnalyticsService));
router.get('/project-trend', analyticsHandler('getProjectTrend', advancedAnalyticsService));
router.get('/department-performance', analyticsHandler('getDepartmentPerformance', advancedAnalyticsService));
router.get('/employee-trend', analyticsHandler('getEmployeeTrend', advancedAnalyticsService));
router.get('/sla-risk', analyticsHandler('getSlaRisk', advancedAnalyticsService));

module.exports = router;
