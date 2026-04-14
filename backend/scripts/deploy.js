// Deployment script for TaskFlow Pro
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 TaskFlow Pro Deployment Script');

// Check environment
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;

function runCommand(command, description) {
  console.log(`\n📋 ${description}`);
  console.log(`$ ${command}`);
  
  try {
    const result = execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log(`✅ ${description} completed\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    return false;
  }
}

function checkPrerequisites() {
  console.log('\n🔍 Checking prerequisites...');
  
  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion < 14) {
    console.error('❌ Node.js 14+ required for production deployment');
    return false;
  }
  
  // Check environment variables
  const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    return false;
  }
  
  console.log('✅ Prerequisites check passed');
  return true;
}

function setupEnvironment() {
  console.log('\n⚙️ Setting up environment...');
  
  // Create production config if it doesn't exist
  const configPath = path.join(__dirname, '..', 'config', 'production.env');
  if (!fs.existsSync(configPath)) {
    console.log('📝 Creating production configuration file...');
    console.log('Please configure your production settings in: config/production.env');
    console.log('Required variables:');
    console.log('- DATABASE_URL=postgresql://user:password@host:port/database');
    console.log('- JWT_SECRET=your_jwt_secret_here');
    console.log('- SMTP_* variables for email service');
    console.log('- STRIPE_SECRET_KEY for payments');
    return false;
  }
  
  console.log('✅ Environment setup completed');
  return true;
}

function runMigrations() {
  console.log('\n🗄️ Running database migrations...');
  return runCommand('node scripts/migrate.js', 'Database migrations');
}

function buildApplication() {
  console.log('\n🔨 Building application...');
  return runCommand('npm run build', 'Frontend build');
}

function startApplication() {
  console.log('\n🚀 Starting application...');
  const command = isProduction ? 'npm start' : 'npm run dev';
  return runCommand(command, 'Application start');
}

function runHealthCheck() {
  console.log('\n🏥 Running health check...');
  const healthUrl = isProduction ? 
    'https://your-domain.com/api/v1/health' : 
    'http://localhost:3001/api/v1/health';
  
  try {
    const response = execSync(`curl -f ${healthUrl}`, { stdio: 'pipe', timeout: 10000 });
    console.log('✅ Health check passed');
    console.log('Response:', response.toString());
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

// Main deployment flow
async function main() {
  console.log('🌟 TaskFlow Pro Deployment Started');
  console.log('=====================================');
  
  if (!checkPrerequisites()) {
    process.exit(1);
  }
  
  if (!setupEnvironment()) {
    process.exit(1);
  }
  
  if (!runMigrations()) {
    process.exit(1);
  }
  
  if (isProduction && !buildApplication()) {
    process.exit(1);
  }
  
  if (!startApplication()) {
    process.exit(1);
  }
  
  // Wait a moment for startup
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  if (!runHealthCheck()) {
    console.error('❌ Deployment completed but health check failed');
    process.exit(1);
  }
  
  console.log('\n🎉 TaskFlow Pro deployment completed successfully!');
  console.log('📊 Application is running and ready for use');
  console.log('🌐 Access URL:', isProduction ? 'https://your-domain.com' : 'http://localhost:5174');
  
  if (isDevelopment) {
    console.log('\n📝 Development tips:');
    console.log('- Use Ctrl+C to stop the server');
    console.log('- Check logs for debugging');
    console.log('- Run "npm run dev" to restart development server');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  });
}
