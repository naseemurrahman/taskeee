// db.js - supports real PostgreSQL or in-memory demo mode
const logger = require('./logger');

// Check if we should use demo mode (for development) or production mode
let useDemo = process.env.NODE_ENV !== 'production';

// Demo data (used when PostgreSQL not available)
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const DEMO_HASH = '$2a$10$FkCjBE42CMITrkT58EDPa.wU3eEvrt3.2BSPA655gN1a0OhzyyVRG'; // Admin@123

// Stable UUIDs so API validation (assignedTo UUID) matches demo logins
const DEMO_ORG = 'a0000001-0000-4000-8000-000000000001';
const USR_ADMIN = 'a0000001-0000-4000-8000-000000000010';

// Production database pool
let pgPool = null;
if (!useDemo) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  
  // Test database connection
  pgPool.on('connect', () => {
    logger.info('PostgreSQL connected');
  });
  
  pgPool.on('error', (err) => {
    logger.error('PostgreSQL connection error:', err);
  });
}

// Production database functions
async function query(sql, params = []) {
  if (useDemo) {
    // Demo mode queries - handle common patterns
    const sqlLower = sql.toLowerCase();
    
    // Handle user queries
    if (sqlLower.includes('from users where') && sqlLower.includes('email =')) {
      const email = params[0];
      const u = demoUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    
    if (sqlLower.includes('insert into users') && !sqlLower.includes('select')) {
      const isSignupInsert = params.length === 4;
      const nu = {
        id: uuidv4(),
        org_id: params[0],
        email: params[1],
        password_hash: params[2],
        full_name: params[3],
        role: isSignupInsert ? 'admin' : params[4],
        manager_id: isSignupInsert ? null : (params[5] || null),
        department: isSignupInsert ? null : (params[6] || null),
        employee_code: isSignupInsert ? null : (params[7] || null),
        is_active: true,
        last_login_at: null,
        phone_e164: null,
        whatsapp_e164: null,
        created_at: new Date()
      };
      
      demoUsers.push(nu);
      return { rows: [nu], rowCount: 1 };
    }
    
    // Handle employee queries
    if (sqlLower.includes('from employees e') && sqlLower.includes('left join users u') && sqlLower.includes('count(*) over()')) {
      const orgId = params[0];
      const limit = parseInt(params[params.length - 2], 10) || 50;
      const offset = parseInt(params[params.length - 1], 10) || 0;
      
      let list = demoEmployees.filter((e) => String(e.org_id) === String(orgId));
      
      const total = list.length;
      const slice = list
        .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
        .slice(offset, offset + limit)
        .map((e) => {
          const u = e.user_id ? demoUsers.find((x) => x.id === e.user_id) : null;
          return {
            ...e,
            linked_user_email: u?.email || null,
            manager_name: null,
            total_count: total,
          };
        });
      return { rows: slice, rowCount: slice.length };
    }
    
    // Handle task queries
    if (sqlLower.includes('insert into tasks')) {
      const task = {
        id: params[0],
        org_id: params[1],
        title: params[2],
        description: params[3],
        status: params[4],
        priority: params[5],
        assigned_to: params[6],
        assigned_by: params[7],
        created_at: params[8],
        updated_at: params[9],
        project_id: params[10] || null,
        department: params[11] || null,
        due_date: params[12] || null
      };
      
      demoTasks.push(task);
      return { rows: [task], rowCount: 1 };
    }
    
    // Handle project queries
    if (sqlLower.includes('insert into projects')) {
      const project = {
        id: params[0],
        org_id: params[1],
        name: params[2],
        description: params[3] || null,
        status: params[4] || 'active',
        created_by: params[5],
        created_at: params[6],
        updated_at: params[7]
      };
      
      demoProjects.push(project);
      return { rows: [project], rowCount: 1 };
    }
    
    // Default response for demo mode
    return { rows: [], rowCount: 0 };
  } else {
    // Production mode - use PostgreSQL
    const result = await pgPool.query(sql, params);
    return result;
  }
}

// Initialize demo data
let demoUsers = [];
let demoEmployees = [];
let demoTasks = [];
let demoProjects = [];
let demoOrgs = [];

// Load existing demo users from file system if available (for persistence)
try {
  const fs = require('fs');
  const path = require('path');
  const demoDataPath = path.join(process.cwd(), 'demo-data.json');
  if (fs.existsSync(demoDataPath)) {
    const existingData = JSON.parse(fs.readFileSync(demoDataPath, 'utf8'));
    console.log('Demo mode - Loading existing data from file');
    
    // Use existing data if available
    if (existingData.users && existingData.users.length > 0) {
      demoUsers = existingData.users;
    }
    if (existingData.orgs && existingData.orgs.length > 0) {
      demoOrgs = existingData.orgs;
    }
    if (existingData.employees && existingData.employees.length > 0) {
      demoEmployees = existingData.employees;
    }
  }
} catch (err) {
  console.log('Demo mode - No existing data file found, using defaults');
}

// Add default demo users if no existing data
if (demoUsers.length === 0) {
  demoUsers.push(
    { id: USR_ADMIN, org_id: DEMO_ORG, email: 'admin@acme.com', password_hash: DEMO_HASH, full_name: 'Admin User', role: 'admin', manager_id: null, is_active: true, last_login_at: null, department: 'Management', employee_code: 'ADM001', phone_e164: null, whatsapp_e164: null, created_at: new Date() }
  );
}

// Add default organization if no existing data
if (demoOrgs.length === 0) {
  demoOrgs.push(
    { id: DEMO_ORG, name: 'Acme Corporation', slug: 'acme', domain: 'acme.com', settings: {}, created_at: new Date(), updated_at: new Date() }
  );
}

// Helper functions
async function getUserByEmail(email) {
  if (useDemo) {
    return demoUsers.find(u => u.email === email);
  } else {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }
}

async function getUserById(id) {
  if (useDemo) {
    return demoUsers.find(u => u.id === id);
  } else {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
}

async function getDepartments(orgId) {
  if (useDemo) {
    const departments = [...new Set(demoUsers.map(u => u.department).filter(d => d && d.trim() !== ''))];
    return departments.map(dept => ({ department: dept }));
  } else {
    const result = await query('SELECT DISTINCT department FROM users WHERE org_id = $1 AND department IS NOT NULL', [orgId]);
    return result.rows;
  }
}

// Transaction helper function
async function withTransaction(callback) {
  if (useDemo) {
    // In demo mode, just execute the callback without transaction
    return await callback({ query });
  } else {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({ query: client.query.bind(client) });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

// Export functions and data
module.exports = {
  query,
  withTransaction,
  getUserByEmail,
  getUserById,
  getDepartments,
  useDemo,
  isDemo: () => useDemo,
  getDemoUsers: () => demoUsers,
  getDemoOrgs: () => demoOrgs,
  getPool: () => pgPool,
  connectDB: async () => {
    if (!useDemo && pgPool) {
      try {
        await pgPool.query('SELECT 1');
        logger.info('Database connection established');
      } catch (error) {
        logger.error('Database connection failed:', error);
        throw error;
      }
    } else {
      logger.info('Demo mode - skipping database connection');
    }
  }
};