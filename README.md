# TaskFlow Pro (Production-ready SPA + API)

## Services
- **Frontend**: Vite + React + TypeScript SPA in `frontend/`
- **Backend**: Express API in `backend/`
- **DB/Cache**: Postgres + Redis

## Environment setup

### Backend
Copy and fill:
- `backend/.env.example` → `backend/.env`

Required for auth in production:
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `MFA_ENCRYPTION_KEY` (32+ bytes)
- `SMTP_*` (for email verification + reset password)

Stripe subscriptions:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`

### Frontend
Copy and fill:
- `frontend/.env.example` → `frontend/.env`

## Run locally (without Docker)

### 1) Start Postgres + Redis
Use your local installation, or Docker Desktop.

### 2) Run migrations

```bash
cd backend
npm install
npm run migrate
```

### 3) Start backend

```bash
cd backend
npm run dev
```

### 4) Start frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server: `http://localhost:5173`  
Backend health: `http://localhost:3001/health`

## Run with Docker Compose
This repo includes a `docker-compose.yml`, but **Docker Desktop must be running** on Windows.

```bash
docker compose up -d --build
```

## Auth flow (production)
- Signup creates account + sends verification email
- Verify email via `/verify-email?token=...`
- Login returns `mfaRequired` when MFA is enabled
- MFA verified via `/mfa`

