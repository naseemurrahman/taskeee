const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { sendEmployeeWelcomeNotification, verifyTempPassword } = require('../services/employeeNotificationService');
const logger = require('../utils/logger');

// POST /auth/verify-temp-password
router.post('/verify-temp-password', async (req, res, next) => {
  try {
    const { userId, tempPassword } = req.body;
    
    if (!userId || !tempPassword) {
      return res.status(400).json({ error: 'User ID and temporary password are required' });
    }
    
    const result = await verifyTempPassword(userId, tempPassword);
    
    if (result.valid) {
      res.json({ 
        success: true,
        message: 'Password verified successfully. You can now set your permanent password.'
      });
    } else {
      res.status(400).json({ 
        success: false,
        error: result.error || 'Invalid temporary password'
      });
    }
    
  } catch (error) {
    logger.error('Error verifying temporary password:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
