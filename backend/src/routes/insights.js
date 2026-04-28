const express = require('express');
const router = express.Router();
const insightsService = require('../services/insightsService');
const { authenticate, requireAnyRole } = require('../middleware/auth');

const ROLES = ['employee', 'hr', 'manager', 'supervisor', 'director', 'admin'];

function filters(req) {
  return {
    from: req.query.from,
    to: req.query.to,
    days: req.query.days,
    employeeId: req.query.employeeId,
    projectId: req.query.projectId,
  };
}

router.use(authenticate, requireAnyRole(...ROLES));

router.get('/', async (req, res, next) => {
  try {
    const data = await insightsService.getOverview(req.user, filters(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const data = await insightsService.getOverview(req.user, filters(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
