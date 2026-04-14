# TaskFlow Pro

A modern, premium task management application with a beautiful UI/UX built with React, TypeScript, and Node.js.

![TaskFlow Pro](https://via.placeholder.com/800x400?text=TaskFlow+Pro)

## Features

- **Dashboard** - Overview of your tasks, projects, and team activity
- **Task Management** - Create, assign, and track tasks with status workflow
- **Projects** - Organize work into projects with milestones
- **Kanban Board** - Visual task management with drag-and-drop
- **Calendar** - Timeline view of all tasks and deadlines
- **Team Directory** - Manage team members and roles
- **HR Management** - Employee records, time-off requests
- **CRM** - Pipeline and leads management
- **Analytics** - Performance insights and reports
- **Dark/Light Theme** - Premium UI with modern animations

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- React Router v6
- TanStack Query (data fetching)
- Recharts (charts)
- Lucide React (icons)
- CSS3 (premium animations & gradients)

### Backend
- Node.js + Express
- PostgreSQL (database)
- Redis (caching)
- JWT (authentication)
- Socket.io (real-time)
- Multer (file uploads)

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### Local Development

1. **Clone and install**
```bash
git clone https://github.com/YOUR_USERNAME/taskee.git
cd taskee
npm install
```

2. **Setup environment**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials
```

3. **Start databases (Docker)**
```bash
docker compose up -d postgres redis
```

4. **Run migrations**
```bash
cd backend
npm run migrate
```

5. **Start servers**
```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```

6. **Open browser**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Deployment

### Fly.io (Recommended)

1. **Install Fly CLI**
```bash
winget install fly.io.fly
fly auth login
```

2. **Deploy**
```bash
fly launch
fly secrets set DATABASE_URL="postgres://..."
fly secrets set REDIS_URL="redis://..."
fly secrets set JWT_SECRET="your-secret"
fly secrets set JWT_REFRESH_SECRET="your-refresh-secret"
fly deploy
```

3. **Set environment variables**
```bash
fly secrets set CLIENT_ORIGIN="https://your-app.fly.dev"
fly secrets set SMTP_HOST="smtp.example.com"
# ... add other required secrets
```

### Docker Compose (Self-hosted)

```bash
# Build and run
docker compose up -d --build

# The app will be available at http://localhost:8080
```

### Manual Deployment

1. **Build frontend**
```bash
cd frontend
npm install
VITE_API_BASE_URL=https://api.yourdomain.com npm run build
```

2. **Setup backend**
```bash
cd backend
npm ci --only=production
# Configure .env with production values
```

3. **Serve with nginx**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3001/;
    }
}
```

## Environment Variables

### Backend (.env)
```env
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret
CLIENT_ORIGIN=https://your-domain.com
MFA_ENCRYPTION_KEY=32-char-encryption-key
```

### Optional (for full features)
```env
# Stripe Billing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...

# Email
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@...
SMTP_PASS=your-password
SMTP_FROM=noreply@yourdomain.com

# AWS S3 (file uploads)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=taskflow-photos
```

## Project Structure

```
taskee/
├── frontend/              # React SPA
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── pages/        # Route pages
│   │   │   ├── app/      # Authenticated app pages
│   │   │   └── marketing/# Public marketing pages
│   │   ├── shell/        # App layout & navigation
│   │   ├── lib/          # Utilities (API, auth)
│   │   └── state/        # State management
│   └── nginx.conf        # Production nginx config
│
├── backend/              # Express API
│   ├── src/
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Business logic
│   │   ├── middleware/   # Auth, error handling
│   │   └── utils/        # DB, Redis, etc.
│   ├── migrations/       # Database migrations
│   └── scripts/          # Utility scripts
│
├── docker-compose.yml    # Local development
├── Dockerfile            # Production image
└── fly.toml              # Fly.io config
```

## API Documentation

Base URL: `https://your-api-domain.com/api/v1`

### Authentication
- `POST /auth/login` - Login
- `POST /auth/signup` - Register
- `POST /auth/refresh` - Refresh token
- `POST /auth/logout` - Logout

### Tasks
- `GET /tasks` - List tasks
- `POST /tasks` - Create task
- `PUT /tasks/:id` - Update task
- `DELETE /tasks/:id` - Delete task

### Projects
- `GET /projects` - List projects
- `POST /projects` - Create project
- `PUT /projects/:id` - Update project

### Users
- `GET /users` - List users
- `GET /users/:id` - Get user
- `PUT /users/:id` - Update user

Full API docs coming soon at `/api-docs`

## License

MIT License - feel free to use for personal or commercial projects.

## Support

For issues and feature requests, please open an issue on GitHub.
