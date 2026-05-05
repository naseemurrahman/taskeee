'use strict';

const modules = [
  './src/server',
  './src/routes/auth',
  './src/routes/tasks',
  './src/routes/projects',
  './src/routes/admin',
  './src/routes/notifications',
  './src/middleware/security',
  './src/middleware/auth',
  './src/utils/validation',
];

for (const mod of modules) {
  try {
    require(`../${mod.replace(/^\.\//, '')}`);
    console.log(`ok ${mod}`);
  } catch (err) {
    console.error(`failed ${mod}`);
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

console.log('backend smoke ok');
process.exit(0);
