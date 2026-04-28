const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');

router.get('/summary', async (req, res) => {
  try {
    const data = await analyticsService.getSummary();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

module.exports = router;
