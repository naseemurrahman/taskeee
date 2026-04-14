FROM node:20-alpine

WORKDIR /app

# Best practice: copy package files first for layer caching
COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]
