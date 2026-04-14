// src/services/subscriptionService.js
const { query } = require('../utils/db');
const logger = require('../utils/logger');

/**
 * Check organization subscription limits for employee additions
 */
async function checkEmployeeAdditionLimit(orgId) {
  try {
    // Get organization subscription info
    const { rows: orgRows } = await query(
      `SELECT settings FROM organizations WHERE id = $1`,
      [orgId]
    );
    
    if (orgRows.length === 0) {
      return { allowed: false, reason: 'Organization not found', limit: 0, current: 0 };
    }
    
    const orgSettings = orgRows[0].settings || {};
    const subscription = orgSettings.subscription || {};
    
    // Default limits for different subscription tiers
    const limits = {
      free: { employees: 5, projects: 3 },
      starter: { employees: 20, projects: 10 },
      professional: { employees: 50, projects: 25 },
      enterprise: { employees: 200, projects: 100 }
    };
    
    const tier = subscription.tier || 'free';
    const limit = limits[tier] || limits.free;
    
    // Get current employee count
    const { rows: employeeRows } = await query(
      `SELECT COUNT(*)::int as count FROM employees WHERE org_id = $1`,
      [orgId]
    );
    
    const currentEmployees = employeeRows[0]?.count || 0;
    
    const isAllowed = currentEmployees < limit.employees;
    const remainingSlots = Math.max(0, limit.employees - currentEmployees);
    
    return {
      allowed: isAllowed,
      reason: isAllowed ? null : `Employee limit exceeded (${currentEmployees}/${limit.employees})`,
      limit: limit.employees,
      current: currentEmployees,
      remaining: remainingSlots,
      tier,
      subscription
    };
    
  } catch (error) {
    logger.error('Error checking employee addition limit:', error.message);
    logger.error('Full error details:', error);
    return { allowed: false, reason: `Failed to check subscription: ${error.message}`, limit: 0, current: 0 };
  }
}

/**
 * Check if organization can add more employees
 */
async function canAddEmployee(orgId) {
  const check = await checkEmployeeAdditionLimit(orgId);
  return check.allowed;
}

/**
 * Get subscription information for display
 */
async function getSubscriptionInfo(orgId) {
  const check = await checkEmployeeAdditionLimit(orgId);
  return {
    tier: check.tier,
    limits: {
      employees: check.limit,
      projects: check.limit
    },
    current: {
      employees: check.current,
      projects: 0 // TODO: Add project counting if needed
    },
    remaining: {
      employees: check.remaining,
      projects: check.limit // TODO: Add remaining projects calculation
    }
  };
}

module.exports = {
  checkEmployeeAdditionLimit,
  canAddEmployee,
  getSubscriptionInfo
};
