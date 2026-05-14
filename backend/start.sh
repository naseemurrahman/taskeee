#!/bin/sh
set -e

echo "[start] Running database migrations in background..."
node src/utils/migrate.js &

echo "[start] Starting server..."
exec node src/server.js
