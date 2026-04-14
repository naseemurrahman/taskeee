const { Pool } = require('pg');
require('dotenv').config();

async function checkEmployeeAccess() {
  console.log('=== CHECKING EMPLOYEE ACCESS SETUP ===');
  
  try {
    // Connect to real database
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false
    });
    
    const client = await pool.connect();
    
    try {
      // 1. Check employees without user accounts
      console.log('\n1. Checking employees without user accounts...');
      const { rows: employeesWithoutUsers } = await client.query(`
        SELECT e.id, e.full_name, e.work_email, e.user_id
        FROM employees e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE u.id IS NULL
      `);
      console.log(`Found ${employeesWithoutUsers.length} employees without user accounts:`);
      employeesWithoutUsers.forEach(emp => {
        console.log(`  - ${emp.full_name} (${emp.work_email}) - User ID: ${emp.user_id}`);
      });
      
      // 2. Check user accounts without passwords (from employee creation)
      console.log('\n2. Checking user accounts with default passwords...');
      const { rows: usersWithDefaultPasswords } = await client.query(`
        SELECT u.id, u.email, u.full_name, u.role, u.password_hash
        FROM users u
        JOIN employees e ON u.id = e.user_id
      `);
      console.log(`Found ${usersWithDefaultPasswords.length} user accounts linked to employees:`);
      usersWithDefaultPasswords.forEach(user => {
        console.log(`  - ${user.full_name} (${user.email}) - Role: ${user.role}`);
      });
      
      // 3. Check if there's a way to send welcome emails/passwords
      console.log('\n3. Checking employee notification service...');
      try {
        const employeeNotificationService = require('./src/services/employeeNotificationService');
        console.log('Employee notification service found');
        
        // Test if we can send welcome notification to the employee
        if (employeesWithoutUsers.length > 0) {
          const employee = employeesWithoutUsers[0];
          console.log(`\nTesting welcome notification for: ${employee.full_name}`);
          
          // This would normally send email/WhatsApp with temporary password
          const tempPassword = 'TempPassword123!';
          console.log(`Temporary password would be: ${tempPassword}`);
          console.log(`Employee would receive login credentials via email/WhatsApp`);
        }
        
      } catch (error) {
        console.log('Employee notification service not available or error:', error.message);
      }
      
      // 4. Create missing user accounts for employees
      if (employeesWithoutUsers.length > 0) {
        console.log('\n4. Creating missing user accounts for employees...');
        const bcrypt = require('bcryptjs');
        const { v4: uuidv4 } = require('uuid');
        
        // Get org_id from admin user
        const { rows: adminUser } = await client.query(
          'SELECT org_id FROM users WHERE role = $1 LIMIT 1', 
          ['admin']
        );
        const orgId = adminUser[0]?.org_id;
        
        for (const emp of employeesWithoutUsers) {
          if (emp.work_email) {
            // Create user account with temporary password
            const tempPassword = 'TempPassword123!';
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            const userId = uuidv4();
            
            await client.query(`
              INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [userId, orgId, emp.work_email, hashedPassword, emp.full_name, 'employee', true, new Date()]);
            
            // Update employee with user_id
            await client.query(
              'UPDATE employees SET user_id = $1 WHERE id = $2',
              [userId, emp.id]
            );
            
            console.log(`  Created user account for: ${emp.full_name} (${emp.work_email})`);
            console.log(`  Temporary password: ${tempPassword}`);
            console.log(`  Login URL: http://localhost:5174/login`);
          }
        }
      }
      
      console.log('\n=== EMPLOYEE ACCESS SETUP COMPLETE ===');
      
    } finally {
      client.release();
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Error checking employee access:', error.message);
  }
}

checkEmployeeAccess();
