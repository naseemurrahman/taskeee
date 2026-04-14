#!/usr/bin/env node

// Production Environment Setup Script
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

console.log('🚀 TaskFlow Pro Production Environment Setup');
console.log('=====================================');

const requiredVars = [
  { name: 'DATABASE_URL', description: 'PostgreSQL database connection string' },
  { name: 'JWT_SECRET', description: 'JWT secret key (32+ characters)' },
  { name: 'SMTP_USER', description: 'Gmail SMTP username' },
  { name: 'SMTP_PASS', description: 'Gmail app password' },
  { name: 'STRIPE_SECRET_KEY', description: 'Stripe live secret key' },
  { name: 'CLIENT_ORIGIN', description: 'Frontend application URL' }
];

function askQuestion(question, isPassword = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function setupEnvironment() {
  console.log('\n📝 Setting up production environment...');
  
  const configPath = path.join(__dirname, '..', 'config', 'production.env');
  
  // Check if config file exists
  if (fs.existsSync(configPath)) {
    console.log('⚠️  Production config file already exists');
    console.log('Current configuration:');
    const currentConfig = fs.readFileSync(configPath, 'utf8');
    console.log(currentConfig);
    return;
  }
  
  console.log('Creating new production configuration...');
  
  const config = {};
  
  for (const varInfo of requiredVars) {
    const answer = await askQuestion(`Enter ${varInfo.description} (${varInfo.name}):`);
    
    if (!answer.trim()) {
      console.log(`❌ ${varInfo.name} is required`);
      process.exit(1);
    }
    
    if (varInfo.name === 'DATABASE_URL') {
      // Validate database URL format
      if (!answer.includes('postgresql://')) {
        console.log('❌ DATABASE_URL must start with postgresql://');
        process.exit(1);
      }
    }
    
    config[varInfo.name] = answer.trim();
  }
  
  // Add optional production settings
  const optionalVars = [
    { name: 'REDIS_URL', description: 'Redis connection URL (optional)' },
    { name: 'SMTP_FROM', description: 'From email address (optional)' },
    { name: 'NODE_ENV', description: 'Environment (should be production)', default: 'production' }
  ];
  
  for (const varInfo of optionalVars) {
    const answer = await askQuestion(`Enter ${varInfo.description} (${varInfo.name}) [optional]:`);
    config[varInfo.name] = answer.trim() || undefined;
  }
  
  // Write configuration file
  const configContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync(configPath, configContent);
  
  console.log('✅ Production configuration saved to config/production.env');
  console.log('\n📋 Configuration Summary:');
  Object.entries(config).forEach(([key, value]) => {
    const status = value ? '✅ SET' : '⚠️ NOT SET';
    console.log(`${status} ${key}: ${value || '(not set)'}`);
  });
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Run: npm run migrate');
  console.log('2. Run: npm run test:production');
  console.log('3. Run: npm run deploy');
  console.log('4. Set up PostgreSQL database server');
  console.log('5. Configure reverse proxy (nginx/Apache)');
}

if (require.main === module) {
  setupEnvironment()
    .catch(error => {
      console.error('❌ Setup failed:', error.message);
      process.exit(1);
    });
}
