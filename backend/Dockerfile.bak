# ===========================================
# TaskFlow Pro - Backend Dockerfile for Railway
# ===========================================

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Run migrations then start server
CMD sh -c "node scripts/migrate.js && node src/server.js"
