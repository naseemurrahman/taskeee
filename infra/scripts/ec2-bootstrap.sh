#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# TASKEE EC2 Bootstrap Script
# Runs ONCE at first launch via user_data.
# Sets up: Node.js 20, PM2, Nginx, SSL (Certbot), app code from GitHub.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
LOG=/var/log/taskee-bootstrap.log
exec > >(tee -a $LOG) 2>&1
echo "=== TASKEE Bootstrap started $(date) ==="

PROJECT="${project}"
DB_HOST="${db_host}"
AWS_REGION="${aws_region}"
SECRET_ARN="${secret_arn}"
APP_DIR="/opt/taskee"
APP_USER="taskee"

# ─── 1. System packages ───────────────────────────────────────────────────────
dnf update -y
dnf install -y git nginx certbot python3-certbot-nginx jq unzip

# ─── 2. Node.js 20 (LTS) via NodeSource ──────────────────────────────────────
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
node --version && npm --version

# ─── 3. PM2 process manager ───────────────────────────────────────────────────
npm install -g pm2
pm2 startup systemd -u $APP_USER --hp /home/$APP_USER || true

# ─── 4. Application user ─────────────────────────────────────────────────────
id -u $APP_USER &>/dev/null || useradd -m -s /bin/bash $APP_USER
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

# ─── 5. Fetch secrets from Secrets Manager → /etc/taskee.env ─────────────────
aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --region "$AWS_REGION" \
  --query 'SecretString' \
  --output text | jq -r 'to_entries[] | "\(.key)=\(.value)"' > /etc/taskee.env

chmod 600 /etc/taskee.env
chown $APP_USER:$APP_USER /etc/taskee.env
echo "NODE_ENV=production" >> /etc/taskee.env
echo "PORT=3001" >> /etc/taskee.env

# ─── 6. Clone application ────────────────────────────────────────────────────
# Using a deploy key (added to GitHub repo settings)
sudo -u $APP_USER git clone https://github.com/naseemurrahman/taskeee.git $APP_DIR
cd $APP_DIR/backend
sudo -u $APP_USER npm ci --production

# Run database migrations
sudo -u $APP_USER bash -c "
  set -a; source /etc/taskee.env; set +a
  node src/utils/migrate.js
"

# ─── 7. PM2 ecosystem config ──────────────────────────────────────────────────
cat > $APP_DIR/ecosystem.config.js << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'taskee-api',
    cwd: '/opt/taskee/backend',
    script: 'src/server.js',
    instances: 1,               // t3.micro has 2 vCPU but 1GB RAM — 1 instance is safe
    exec_mode: 'fork',
    env_file: '/etc/taskee.env',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    // Auto-restart on crash, memory limit safety net
    max_memory_restart: '750M',
    restart_delay: 3000,
    max_restarts: 10,
    // Logging
    out_file: '/var/log/taskee/out.log',
    error_file: '/var/log/taskee/error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
PM2EOF

mkdir -p /var/log/taskee
chown -R $APP_USER:$APP_USER /var/log/taskee

sudo -u $APP_USER pm2 start $APP_DIR/ecosystem.config.js
sudo -u $APP_USER pm2 save

# ─── 8. Nginx configuration ───────────────────────────────────────────────────
cat > /etc/nginx/conf.d/taskee-api.conf << 'NGINXEOF'
# Redirect all HTTP to HTTPS
server {
    listen 80;
    server_name api.taskee.app;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.taskee.app;

    # SSL managed by Certbot — will be populated after cert issuance
    ssl_certificate     /etc/letsencrypt/live/api.taskee.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.taskee.app/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    # API proxy
    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket support (Socket.io)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Generous timeouts for long-running operations
        proxy_read_timeout    300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout    300s;

        # Upload size limit (task photo evidence)
        client_max_body_size 20M;
    }

    # Health check endpoint (no logging)
    location /health {
        proxy_pass http://127.0.0.1:3001/health;
        access_log off;
    }
}
NGINXEOF

# Test nginx config before enabling
nginx -t
systemctl enable nginx
systemctl start nginx

# ─── 9. SSL certificate via Let's Encrypt ─────────────────────────────────────
# Note: DNS must be pointing to this EC2 IP BEFORE running this.
# Certbot will fail if DNS isn't ready — it auto-retries on next cron run.
certbot --nginx -d api.taskee.app --non-interactive --agree-tos \
  -m admin@taskee.app --redirect || echo "Certbot: DNS not ready yet, will retry"

# Auto-renew cron
echo "0 3 * * * certbot renew --quiet && systemctl reload nginx" | crontab -

# ─── 10. CloudWatch agent (free log shipping) ─────────────────────────────────
dnf install -y amazon-cloudwatch-agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWEOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/taskee/out.log",
            "log_group_name": "/taskee/app/stdout",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/taskee/error.log",
            "log_group_name": "/taskee/app/stderr",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/nginx/error.log",
            "log_group_name": "/taskee/nginx/error",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
CWEOF
systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "=== TASKEE Bootstrap complete $(date) ==="
echo "API running at: http://localhost:3001"
echo "Next: update DNS and run certbot for SSL"
