const { query } = require('../src/utils/db');

async function run() {
  const legacy = await query(`
    SELECT COUNT(*)::int AS c
    FROM tasks t
    JOIN employees e ON e.id = t.assigned_to
    WHERE e.user_id IS NOT NULL
  `);
  const orphan = await query(`
    SELECT COUNT(*)::int AS c
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.assigned_to IS NOT NULL AND u.id IS NULL
  `);
  console.log(JSON.stringify({
    legacyEmployeeAssigneeRefs: legacy.rows[0]?.c || 0,
    orphanAssigneeRefs: orphan.rows[0]?.c || 0,
  }, null, 2));
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
