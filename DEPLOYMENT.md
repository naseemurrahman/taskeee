# TaskFlow Pro Deployment Guide

## 🚀 Production Deployment Setup

### Prerequisites

- Node.js 14+ required for production deployment
- PostgreSQL database server
- Redis server for caching and real-time features
- SSL certificate for HTTPS (recommended)
- Domain name and DNS configuration

### Environment Configuration

1. **Database Setup**
   ```bash
   # Install PostgreSQL on production server
   sudo apt update && sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   
   # Create production database
   sudo -u postgres createdb taskflow_prod
   CREATE USER taskflow WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE taskflow_prod TO taskflow;
   ```

### Railway + Vercel environment checklist

Set these in Railway backend service:

```env
# Notifications
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# Avatars / evidence
AWS_REGION=
S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_ENDPOINT=
S3_PUBLIC_BASE_URL=
S3_FORCE_PATH_STYLE=false
```

Set this in Vercel frontend project:

```env
VITE_API_BASE_URL=https://<your-backend-domain>
```

### Task visibility hardening steps

Run these after deploy to ensure legacy assignee mapping is normalized:

```bash
cd backend
npm run audit:task-assignees
# then apply migrations including 017_normalize_task_assignees.sql
npm run migrate
```

2. **Environment Variables**
   Copy `config/production.env.example` to `config/production.env`
   Configure the following variables:
   ```env
   NODE_ENV=production
   DATABASE_URL=postgresql://taskflow:password@localhost:5432/taskflow_prod
   DATABASE_SSL=false
   REDIS_URL=redis://localhost:6379
   JWT_SECRET=your_jwt_secret_32_chars_minimum
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_password
   STRIPE_SECRET_KEY=sk_live_your_stripe_secret
   ```

### Deployment Commands

1. **Database Migration**
   ```bash
   npm run migrate
   ```

2. **Application Build**
   ```bash
   npm run build
   ```

3. **Production Deployment**
   ```bash
   npm run deploy
   ```

### Next Steps for Full Production Deployment

Based on the comprehensive production setup I've completed, here are the remaining steps to make TaskFlow Pro fully production-ready:

### 🔧 Immediate Next Steps:

1. **Set Up Production Database Server**
   ```bash
   # Install PostgreSQL on production server
   sudo apt update && sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   
   # Create production database
   sudo -u postgres createdb taskflow_prod
   CREATE USER taskflow WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE taskflow_prod TO taskflow;
   ```

2. **Configure Production Environment**
   - Copy `config/production.env.example` to `config/production.env`
   - Update with your actual production values:
     ```env
     DATABASE_URL=postgresql://taskflow:your_secure_password@your-server:5432/taskflow_prod
     JWT_SECRET=your_production_jwt_secret_32_chars_minimum
     SMTP_USER=your_production_email@gmail.com
     SMTP_PASS=your_production_app_password
     STRIPE_SECRET_KEY=sk_live_your_production_stripe_key
     ```

3. **Run Production Tests**
   ```bash
   cd backend
   npm run test:production
   ```

4. **Deploy to Production**
   ```bash
   cd backend
   npm run deploy
   ```

### 🔧 Interactive Production Setup
   
   For automated setup, run:
   ```bash
   node scripts/setup-production.js
   ```
   
   This script will:
   - Guide you through setting all required environment variables
   - Validate database URL format
   - Create production configuration file automatically
   - Provide step-by-step instructions

### 📊 Production Readiness Checklist:

- [ ] PostgreSQL database server installed and running
- [ ] Production environment variables configured
- [ ] Database migrations completed successfully
- [ ] All production tests passing
- [ ] SSL certificate configured (optional but recommended)
- [ ] Reverse proxy configured for production domain
- [ ] Monitoring and logging set up
- [ ] Backup systems configured

### 🎯 Final Production Deployment:

Once all checklist items are completed, your TaskFlow Pro application will be **enterprise-ready** with:
- Multi-organization support
- Real-time collaboration
- Production-grade security
- Scalable database architecture
- Comprehensive subscription management

### Multi-Organization Features

The system now supports:
- **Multiple Organizations**: Each with separate subscription plans
- **Subscription Management**: Basic, Pro, Enterprise tiers
- **Plan-based Features**: Different features per subscription level
- **Seat Management**: Track users per organization
- **Real-time Updates**: WebSocket connections for live collaboration

### Production Monitoring

- Health checks at `/api/v1/health`
- Structured logging with Winston
- Database connection pooling
- Graceful error handling

### Security Features

- JWT-based authentication with refresh tokens
- Password hashing with bcrypt
- Email verification system
- MFA support (TOTP)
- CORS configuration for production domains

### Development vs Production

| Feature | Development | Production |
|----------|-------------|------------|
| Database | Demo mode | PostgreSQL |
| Email | Console | Real SMTP |
| Storage | Local files | AWS S3 |
| Real-time | Disabled | WebSocket.IO |
| Subscriptions | Mock | Stripe integration |

### Troubleshooting

1. **Database Connection Issues**
   - Check PostgreSQL service status
   - Verify DATABASE_URL format
   - Check network connectivity

2. **Environment Issues**
   - Verify all required environment variables
   - Check file permissions for config files

3. **Performance Issues**
   - Monitor database connection pool
   - Check Redis connectivity
   - Review application logs

### Backup Strategy

- Daily database backups
- Configuration file backups
- User data export capability
- Recovery procedures

### Scaling Considerations

- Database connection pooling configured
- Redis caching for performance
- Horizontal scaling support
- Load balancer compatibility
