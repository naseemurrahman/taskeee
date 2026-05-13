# TASKEE — AWS Migration Guide
## Railway + Vercel → EC2 + RDS + S3 + CloudFront
### Target cost: ~$24/month | Current: Railway + Vercel (higher)

---

## Prerequisites (do these first)

```bash
# Install tools on your local machine
brew install terraform awscli postgresql

# Configure AWS CLI with your credentials
aws configure
# → Access Key ID:     (from AWS IAM → Users → Security credentials)
# → Secret Access Key: (from same page)
# → Default region:    us-east-1
# → Output format:     json

# Generate SSH key for EC2 access
ssh-keygen -t rsa -b 4096 -f ~/.ssh/taskee_deploy -N ""
# This creates: ~/.ssh/taskee_deploy (private) and ~/.ssh/taskee_deploy.pub (public)
```

---

## Phase 1 — AWS Account Setup (5 minutes)

### 1.1 Create S3 bucket for Terraform state
```bash
aws s3 mb s3://taskee-terraform-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket taskee-terraform-state \
  --versioning-configuration Status=Enabled
```

### 1.2 Create IAM user for GitHub Actions deployments
```bash
aws iam create-user --user-name taskee-deploy
aws iam attach-user-policy \
  --user-name taskee-deploy \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam create-access-key --user-name taskee-deploy
# ↑ Save the AccessKeyId and SecretAccessKey — you'll need them for GitHub Secrets
```

---

## Phase 2 — Provision Infrastructure with Terraform (15 minutes)

### 2.1 Configure variables
```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your values:
# - domain_name: your domain (e.g. taskee.app)
# - admin_ip_cidr: run `curl ifconfig.me` and add /32
# - db_password: generate with: openssl rand -base64 24
# - jwt_secret: openssl rand -hex 64
# - jwt_refresh_secret: openssl rand -hex 64
nano terraform.tfvars
```

### 2.2 Initialize and apply Terraform
```bash
terraform init
terraform plan   # Review what will be created
terraform apply  # Type 'yes' to confirm
```

This takes ~10-15 minutes (RDS takes the longest).

### 2.3 Save the outputs
```bash
terraform output
# You'll see:
#   ec2_public_ip          = "X.X.X.X"          ← your server IP
#   cloudfront_id          = "EXXXXXXXXX"         ← for GitHub Secrets
#   frontend_bucket        = "taskee-frontend-prod"
#   route53_nameservers    = ["ns-XXX.awsdns-XX..."] ← update at registrar
#   secret_arn             = "arn:aws:secretsmanager:..."
```

### 2.4 Update domain nameservers
Log into your domain registrar (Namecheap/GoDaddy) and replace the
nameservers with the 4 values from `terraform output route53_nameservers`.

DNS propagation takes 5-60 minutes. Check with:
```bash
dig NS yourdomain.com +short
```

---

## Phase 3 — Migrate Database (10 minutes)

```bash
# Run from your local machine
chmod +x infra/scripts/migrate-db.sh
./infra/scripts/migrate-db.sh
```

The script will:
1. Ask for your Railway DATABASE_URL (from Railway dashboard → Variables)
2. Ask for your RDS details (from `terraform output`)
3. Dump Railway DB to a local .dump file
4. Restore it to RDS
5. Show row counts to confirm success

---

## Phase 4 — Configure GitHub Secrets (5 minutes)

Go to your GitHub repo → Settings → Secrets → Actions → New repository secret

Add these secrets:

| Secret Name | Value |
|---|---|
| `EC2_HOST` | Value of `terraform output ec2_public_ip` |
| `EC2_SSH_PRIVATE_KEY` | Content of `~/.ssh/taskee_deploy` (private key) |
| `SECRET_ARN` | Value of `terraform output secret_arn` |
| `DOMAIN_NAME` | Your domain (e.g. `taskee.app`) |
| `AWS_ACCESS_KEY_ID` | From IAM user created in Phase 1 |
| `AWS_SECRET_ACCESS_KEY` | From IAM user created in Phase 1 |
| `S3_FRONTEND_BUCKET` | Value of `terraform output frontend_bucket` |
| `CLOUDFRONT_DISTRIBUTION_ID` | Value of `terraform output cloudfront_id` |

---

## Phase 5 — First Deployment (automatic)

Push any commit to `main` — GitHub Actions will:
1. SSH into EC2, pull code, install deps, run migrations, reload PM2
2. Build frontend with Vite, sync to S3, invalidate CloudFront

```bash
git commit --allow-empty -m "trigger: first AWS deployment"
git push origin main
```

Watch progress at: GitHub repo → Actions tab

---

## Phase 6 — SSL Certificate

After DNS is pointing to EC2, SSH in and complete SSL setup:

```bash
ssh -i ~/.ssh/taskee_deploy taskee@$(terraform output -raw ec2_public_ip)

# Issue Let's Encrypt certificate (free, auto-renews)
sudo certbot --nginx -d api.yourdomain.com \
  --email your@email.com \
  --agree-tos \
  --non-interactive
```

---

## Phase 7 — Verify Everything

```bash
# API health check
curl https://api.yourdomain.com/health

# Frontend loads
curl -I https://yourdomain.com

# WebSocket (Socket.io) works — open browser console on your app
# You should see: "Socket connected"
```

---

## Phase 8 — Decommission Railway + Vercel

Only after verifying everything works for 24 hours:

1. Railway: Pause services → Delete project
2. Vercel: Go to project settings → Delete project

**Estimated savings: Railway (~$20/mo) + Vercel Pro (~$20/mo) = $40/month saved**
**New AWS cost: ~$24/month = net saving of ~$16/month**

---

## Ongoing Operations

### Deploy a new version
```bash
git push origin main   # GitHub Actions handles everything automatically
```

### SSH into EC2
```bash
ssh -i ~/.ssh/taskee_deploy taskee@YOUR_EC2_IP
```

### View application logs
```bash
pm2 logs taskee-api          # Live tail
pm2 logs taskee-api --lines 100  # Last 100 lines
# Or in AWS CloudWatch → Log groups → /taskee/app/stdout
```

### Restart the API
```bash
pm2 reload taskee-api        # Zero-downtime reload
pm2 restart taskee-api       # Full restart (brief downtime)
```

### Scale up if traffic grows
```bash
# Change instance type in terraform.tfvars:
# t3.micro → t3.small ($17/mo) → t3.medium ($33/mo)
terraform apply
# Takes ~5 minutes, ~2 min downtime
```

### Monthly cost breakdown
| Service | Cost |
|---|---|
| EC2 t3.micro | $8.50 |
| RDS t4g.micro (20GB) | $12.50 |
| S3 + CloudFront | $1.50 |
| Route 53 | $0.50 |
| Secrets Manager | $0.40 |
| CloudWatch Logs | $0.50 |
| **Total** | **~$24/month** |

> 💡 **Free tier bonus:** If your AWS account is less than 12 months old,
> EC2 t2.micro is completely FREE — bringing your total to ~$15/month.
