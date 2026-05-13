#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# TASKEE Database Migration: Railway PostgreSQL → AWS RDS
# Run this from your local machine with both Railway and RDS accessible.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     TASKEE: Railway → AWS RDS Database Migration         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── Prerequisites check ──────────────────────────────────────────────────────
command -v psql  >/dev/null 2>&1 || { echo "❌ psql not installed. Run: brew install postgresql"; exit 1; }
command -v pg_dump >/dev/null 2>&1 || { echo "❌ pg_dump not installed. Run: brew install postgresql"; exit 1; }

# ─── Configuration ────────────────────────────────────────────────────────────
# Get Railway DB URL from your Railway dashboard → Variables tab
read -p "Paste your Railway DATABASE_URL (postgresql://...): " RAILWAY_DB_URL

# Get RDS details from Terraform output: terraform output rds_endpoint
read -p "RDS hostname (from terraform output rds_endpoint): " RDS_HOST
read -p "RDS database name [taskee_prod]: " RDS_DB
RDS_DB=${RDS_DB:-taskee_prod}
read -p "RDS username [taskee_admin]: " RDS_USER
RDS_USER=${RDS_USER:-taskee_admin}
read -s -p "RDS password: " RDS_PASS
echo ""

RDS_URL="postgresql://$RDS_USER:$RDS_PASS@$RDS_HOST:5432/$RDS_DB?sslmode=require"

DUMP_FILE="taskee_railway_$(date +%Y%m%d_%H%M%S).dump"

echo ""
echo "── Step 1: Dumping Railway database ──"
echo "   Source: Railway PostgreSQL"
echo "   File:   $DUMP_FILE"
echo ""

pg_dump \
  "$RAILWAY_DB_URL" \
  --format=custom \
  --no-acl \
  --no-owner \
  --verbose \
  --file="$DUMP_FILE"

echo ""
echo "✅ Dump complete: $(ls -lh $DUMP_FILE | awk '{print $5}') compressed"

echo ""
echo "── Step 2: Restoring to AWS RDS ──"
echo "   Target: $RDS_HOST/$RDS_DB"
echo ""

# Create DB if it doesn't exist yet
PGPASSWORD="$RDS_PASS" psql \
  --host="$RDS_HOST" \
  --username="$RDS_USER" \
  --dbname="postgres" \
  --command="CREATE DATABASE $RDS_DB;" 2>/dev/null || echo "  (database already exists)"

# Restore
PGPASSWORD="$RDS_PASS" pg_restore \
  --host="$RDS_HOST" \
  --username="$RDS_USER" \
  --dbname="$RDS_DB" \
  --no-acl \
  --no-owner \
  --verbose \
  "$DUMP_FILE"

echo ""
echo "── Step 3: Verification ──"

ROW_COUNTS=$(PGPASSWORD="$RDS_PASS" psql \
  --host="$RDS_HOST" \
  --username="$RDS_USER" \
  --dbname="$RDS_DB" \
  --tuples-only \
  --command="
    SELECT
      'users:     ' || COUNT(*) FROM users
    UNION ALL SELECT
      'tasks:     ' || COUNT(*) FROM tasks
    UNION ALL SELECT
      'employees: ' || COUNT(*) FROM employees
    UNION ALL SELECT
      'orgs:      ' || COUNT(*) FROM organizations;
  " 2>/dev/null)

echo "$ROW_COUNTS"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ Migration complete!                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                             ║"
echo "║  1. Update DATABASE_URL in AWS Secrets Manager           ║"
echo "║  2. Restart PM2 on EC2: pm2 reload taskee-api            ║"
echo "║  3. Test login at https://api.yourdomain.com/health      ║"
echo "║  4. Keep dump file as backup: $DUMP_FILE"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
