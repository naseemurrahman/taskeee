# ===========================================
# TaskFlow Pro - Production Dockerfile for Railway
# ===========================================

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend
FROM node:20-alpine AS backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production
COPY backend/ ./

# Stage 3: Final
FROM node:20-alpine AS runner
WORKDIR /app

# Install nginx
RUN apk add --no-cache nginx

# Copy backend
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app .

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy nginx config
COPY frontend/nginx.conf /etc/nginx/http.d/default.conf

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Start node server
CMD ["node", "src/server.js"]
