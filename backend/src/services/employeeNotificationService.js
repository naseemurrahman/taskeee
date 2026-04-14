// src/services/employeeNotificationService.js
const { query } = require('../utils/db');
const { emitNotification } = require('./notificationService');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

/**
 * Generate secure random password for new employee
 */
function generateSecurePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Generate email/WhatsApp notification for new employee with login credentials
 */
async function sendEmployeeWelcomeNotification(employee, orgId) {
  try {
    // Generate temporary password
    const tempPassword = generateSecurePassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    // Store the temporary password in users table
    if (employee.user_id) {
      await query(
        `UPDATE users SET password_hash = $1, temp_password = $2, temp_password_expires = $3 WHERE id = $4`,
        [hashedPassword, tempPassword, new Date(Date.now() + 24 * 60 * 60 * 1000), employee.user_id]
      );
    }
    
    // Get organization details for email customization
    const { rows: orgRows } = await query(
      `SELECT name FROM organizations WHERE id = $1`,
      [orgId]
    );
    
    const orgName = orgRows[0]?.name || 'Your Company';
    const loginUrl = process.env.APP_URL || 'http://localhost:8080/signin.html';
    
    // Send professional welcome email using EmailService
    const EmailService = require('./emailService');
    const emailService = new EmailService();
    
    const emailHtml = emailService.getEmployeeWelcomeEmailTemplate(
      employee.full_name,
      employee.work_email || employee.email,
      tempPassword,
      orgName,
      loginUrl
    );
    
    await emailService.sendEmail(
      employee.work_email || employee.email,
      `Welcome to ${orgName} - Your Account Details`,
      emailHtml
    );
    
    // Send in-app notification
    if (employee.user_id) {
      await emitNotification(employee.user_id, {
        type: 'employee_welcome',
        title: `Welcome to ${orgName}!`,
        body: `Your account has been created. Check your email for login credentials.`,
        data: {
          tempPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
          loginUrl
        }
      });
    }
    
    // Send WhatsApp notification (optional)
    try {
      const { sendWhatsApp } = require('./notificationChannels');
      await sendWhatsApp({
        toE164: employee.phone_e164 || employee.phone,
        body: `Welcome to ${orgName}! Your TaskFlow account is ready. Check your email (${employee.work_email || employee.email}) for login credentials.`
      });
    } catch (e) {
      logger.warn('WhatsApp welcome notification failed: ' + e.message);
    }
    
    logger.info(`Welcome notification sent to employee ${employee.full_name} (${employee.work_email || employee.email})`);
    
    return {
      success: true,
      tempPassword,
      tempPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };
    
  } catch (error) {
    logger.error('Error sending employee welcome notification:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Verify employee temporary password and allow first login
 */
async function verifyTempPassword(userId, tempPassword) {
  try {
    const { rows: userRows } = await query(
      `SELECT temp_password, temp_password_expires FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userRows.length === 0) {
      return { valid: false, error: 'User not found' };
    }
    
    const user = userRows[0];
    
    // Check if temp password matches and hasn't expired
    const now = new Date();
    const expiresAt = new Date(user.temp_password_expires);
    
    if (user.temp_password !== tempPassword || now > expiresAt) {
      return { valid: false, error: 'Invalid or expired temporary password' };
    }
    
    // Clear temporary password after successful verification
    await query(
      `UPDATE users SET temp_password = NULL, temp_password_expires = NULL WHERE id = $1`,
      [userId]
    );
    
    logger.info(`Employee ${userId} verified temporary password and cleared`);
    
    return { valid: true };
    
  } catch (error) {
    logger.error('Error verifying temporary password:', error.message);
    return { valid: false, error: error.message };
  }
}

module.exports = {
  sendEmployeeWelcomeNotification,
  verifyTempPassword,
  generateSecurePassword
};
