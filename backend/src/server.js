'use strict';
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: true,
});

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const helmet      = require('helmet');
const cors        = require('cors');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const jwt         = require('jsonwebtoken');

const logger           = require('./utils/logger');

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error('Unhandled promise rejection: ' + msg);
});

const { connectDB, query } = require('./utils/db');
const { connectRedis } = require('./utils/redis');
const errorHandler     = require('./middleware/errorHandler');
const {
  securityHeaders, sensitiveOpLogger
} = require('./middleware/security');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'taskflow-fallback-jwt-secret-change-me';
  logger.warn('JWT_SECRET missing — using fallback secret. Set JWT_SECRET in production.');
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'taskflow-fallback-refresh-secret-change-me';
  logger.warn('JWT_REFRESH_SECRET missing — using fallback secret. Set JWT_REFRESH_SECRET in production.');
}

const authRoutes  = require('./routes/auth');
const userRoutes  = require('./routes/users');
const taskRoutes  = require('./routes/tasks');
const taskBulkActionsRoutes = require('./routes/taskBulkActions');
const photoRoutes = require('./routes/photos');
const reportRoutes= require('./routes/reports');
const notifRoutes = require('./routes/notifications');
const orgRoutes   = require('./routes/organizations');
const performanceRoutes = require('./routes/performance');
const taskMessagesRoutes = require('./routes/taskMessages');
const insightsRoutes = require('./routes/insights');
const integrationsRoutes = require('./routes/integrations');
const searchRoutes = require('./routes/search');
const activityRoutes = require('./routes/activity');
const auditRoutes = require('./routes/audit');
const backupRoutes = require('./routes/backup');
const paymentRoutes = require('./routes/payment');
const projectsRoutes = require('./routes/projects');
const hrisRoutes = require('./routes/hris');
const crmRoutes = require('./routes/crm');
const billingRoutes = require('./routes/billing');
const contractorsRoutes = require('./routes/contractors');
const statsRoutes       = require('./routes/stats');
const analyticsRoutes   = require('./routes/analytics');
const adminRoutes       = require('./routes/admin');

const app    = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];
const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  defaultOrigins.join(',')
).split(',').map(o => o.trim()).filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

const io = new Server(server, {
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
  }
});

if (!process.env.CLIENT_ORIGIN) {
  console.warn('⚠️ CLIENT_ORIGIN not set, WebSocket may not work properly in production');
}

app.set('io', io);
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = d.userId;
    socket.orgId = d.orgId;
    next();
  } catch (err) {
    if (err?.name !== 'TokenExpiredError') {
      logger.warn(`WebSocket authentication error: ${err?.message || 'Invalid token'}`);
    }
    next(new Error('Invalid token'));
  }
});
io.on('connection', socket => {
  if (socket.userId) socket.join(`user:${socket.userId}`);
  socket.on('join:org', ({ orgId }) => {
    if (orgId && String(orgId) === String(socket.orgId)) {
      socket.join(`org:${orgId}`);
      socket.join(`org_${orgId}`);
    }
  });
  socket.on('join:user', ({ userId }) => {
    if (userId && String(userId) === String(socket.userId)) {
      socket.join(`user:${userId}`);
    }
  });
  socket.on('join_task', ({ taskId }) => {
    if (taskId) socket.join(`task:${taskId}`);
  });
  socket.on('notify:user', ({ targetUserId, notification }) => {
    if (socket.orgId) {
      socket.to(`user:${targetUserId}`).emit('notification', notification);
    }
  });
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'",'data:','blob:'], connectSrc: ["'self'"],
      frameSrc: ["'none'"], objectSrc: ["'none'"],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));
app.use(securityHeaders);
app.use(compression());
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Cache-Control','Pragma','X-Requested-With'],
}));

app.use('/api/v1/payment/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));
app.use(sensitiveOpLogger);
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — try again later.' }
}));

app.get('/api/v1/insights/overview', (_req, res) => {
  res.status(200).json({
    generated_at: new Date().toISOString(),
    summary: {
      total_tasks: 0,
      completed_tasks: 0,
      pending_tasks: 0,
      overdue_tasks: 0,
      completion_rate: 0,
      overdue_rate: 0,
      average_ai_confidence: 0,
      average_open_tasks: 0
    },
    insights: []
  });
});

app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/users',         userRoutes);
app.use('/api/v1/tasks/:taskId/messages', taskMessagesRoutes);
app.use('/api/v1/debug', require('./routes/debug'));
app.use('/api/v1/ai',    require('./routes/ai'));
app.use('/api/v1/tasks',         taskBulkActionsRoutes);
app.use('/api/v1/tasks',         taskRoutes);
app.use('/api/v1/photos',        photoRoutes);
app.use('/api/v1/reports',       reportRoutes);
app.use('/api/v1/notifications', notifRoutes);
app.use('/api/v1/organizations', orgRoutes);
app.use('/api/v1/performance', performanceRoutes);
app.use('/api/v1/insights',      insightsRoutes);
app.use('/api/v1/integrations',  integrationsRoutes);
app.use('/api/v1/search',        searchRoutes);
app.use('/api/v1/activity',      activityRoutes);
app.use('/api/v1/audit',         auditRoutes);
app.use('/api/v1/backup',        backupRoutes);
app.use('/api/v1/payment',       paymentRoutes);
app.use('/api/v1/projects',      projectsRoutes);
app.use('/api/v1/hris',          hrisRoutes);
app.use('/api/v1/crm',           crmRoutes);
app.use('/api/v1/billing',       billingRoutes);
app.use('/api/v1/contractors',   contractorsRoutes);
app.use('/api/v1/stats',         statsRoutes);
app.use('/api/v1/analytics',     analyticsRoutes);
app.use('/api/v1/admin',         adminRoutes);

app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'TaskFlow Pro API',
    version: '2.0.0',
    status: 'ok',
    docs: '/api/v1/health',
    timestamp: new Date().toISOString(),
  });
});

async function buildHealthPayload() {
  const start = Date.now();
  const checks = { db: 'unknown', redis: 'unknown' };
  try {
    await query('SELECT 1');
    checks.db = 'ok';
  } catch (e) { checks.db = 'error'; }
  try {
    const { getRedis } = require('./utils/redis');
    const rc = getRedis();
    if (rc) { await rc.ping(); checks.redis = 'ok'; } else { checks.redis = 'unconfigured'; }
  } catch { checks.redis = 'error'; }
  return {
    status: checks.db === 'ok' ? 'ok' : 'starting',
    uptime: Math.floor(process.uptime()),
    latencyMs: Date.now() - start,
    checks,
    timestamp: new Date().toISOString(),
  };
}

app.get('/health', async (_req, res) => {
  const payload = await buildHealthPayload();
  res.status(200).json(payload);
});

app.get('/api/v1/health', async (_req, res) => {
  const payload = await buildHealthPayload();
  res.status(200).json(payload);
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || process.env.RAILWAY_PORT || '8080', 10);

async function start() {
  try {
    const { runEnvCheck } = require('./utils/envCheck');
    runEnvCheck();
  } catch (_) { /* never block startup */ }

  try {
    await connectDB();
  } catch (err) {
    logger.error('Database bootstrap failed, starting API in degraded mode: ' + err.message);
  }
  try {
    await connectRedis();
  } catch (err) {
    logger.warn('Redis bootstrap failed, continuing with fallback cache: ' + err.message);
  }
  try {
    require('./services/schedulerService').start();
  } catch (err) {
    logger.warn('Scheduler failed to start: ' + err.message);
  }
  try {
    const { runAutoMigrations } = require('./utils/autoMigrate');
    await runAutoMigrations();
  } catch (err) {
    logger.warn('Auto-migration warning: ' + err.message);
  }
  server.listen(PORT);
}

server.on('listening', () => {
  logger.info('TaskFlow Pro API started');
  logger.info(`  Health : http://localhost:${PORT}/health`);
  logger.info(`  Login  : POST http://localhost:${PORT}/api/v1/auth/login`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} already in use.`);
    logger.error(`Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <PID> /F`);
    logger.error(`Or add  PORT=3001  to your .env file`);
  } else {
    logger.error('Server error: ' + err.message);
  }
  process.exit(1);
});

start().catch(err => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});

module.exports = { app, server, io };
