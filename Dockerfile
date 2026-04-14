FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./frontend/
WORKDIR /build/frontend/frontend
RUN npm ci
COPY frontend/ ./frontend/
RUN npm run build

FROM node:20-alpine AS backend-builder
WORKDIR /build/backend
COPY backend/package*.json ./backend/
WORKDIR /build/backend/backend
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app

COPY --from=backend-builder /build/backend/node_modules ./node_modules
COPY backend/ ./backend/

COPY --from=frontend-builder /build/frontend/frontend/dist ./frontend/dist

RUN apk add nginx
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY frontend/nginx.conf /etc/nginx/http.d/default.conf

RUN chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
ENV PORT=3001
ENV NGINX_PORT=8080

EXPOSE 8080 3001

# Start nginx in background, then node
CMD sh -c "nginx -g 'daemon off;' & node backend/src/server.js"
