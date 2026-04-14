const { query } = require('../src/utils/db');

async function addDepartments() {
  try {
    console.log('Adding departments to users...');

    // Update existing users with departments
    const updates = [
      { id: '00000000-0000-0000-0000-000000000010', department: 'Management' },
      { id: '00000000-0000-0000-0000-000000000020', department: 'IT' },
      { id: '00000000-0000-0000-0000-000000000030', department: 'Technical' }
    ];

    for (const user of updates) {
      await query(
        'UPDATE users SET department = $1 WHERE id = $2',
        [user.department, user.id]
      );
      console.log(`Updated user ${user.id} with department: ${user.department}`);
    }

    // Add some additional sample users with departments
    const sampleUsers = [
      {
        id: '00000000-0000-0000-0000-000000000040',
        email: 'ahmad@acme.com',
        full_name: 'Ahmad IT Specialist',
        role: 'employee',
        department: 'IT',
        manager_id: '00000000-0000-0000-0000-000000000020',
        employee_code: 'IT001'
      },
      {
        id: '00000000-0000-0000-0000-000000000050',
        email: 'ali@acme.com',
        full_name: 'Ali IT Developer',
        role: 'employee',
        department: 'IT',
        manager_id: '00000000-0000-0000-0000-000000000020',
        employee_code: 'IT002'
      }
    ];

    for (const user of sampleUsers) {
      // Check if user already exists
      const existing = await query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rows.length === 0) {
        await query(`
          INSERT INTO users (id, email, full_name, role, department, manager_id, employee_code, org_id, is_active, email_verified)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          user.id,
          user.email,
          user.full_name,
          user.role,
          user.department,
          user.manager_id,
          user.employee_code,
          '00000000-0000-0000-0000-000000000001', // org_id
          true,
          true
        ]);
        console.log(`Added user: ${user.full_name} (${user.department})`);
      }
    }

    console.log('Departments and sample users added successfully!');
    
    // Verify the departments
    const departments = await query(`
      SELECT DISTINCT department 
      FROM users 
      WHERE department IS NOT NULL AND department != ''
      ORDER BY department
    `);
    
    console.log('Available departments:', departments.rows.map(r => r.department));

  } catch (error) {
    console.error('Error adding departments:', error);
  } finally {
    process.exit(0);
  }
}

addDepartments();
