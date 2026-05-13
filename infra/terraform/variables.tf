variable "project" {
  description = "Project name used as prefix for all AWS resources"
  type        = string
  default     = "taskee"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Your custom domain (e.g. taskee.app or yourdomain.com)"
  type        = string
}

variable "admin_ip_cidr" {
  description = "Your IP address in CIDR format for SSH access (e.g. 203.0.113.5/32). Run: curl ifconfig.me"
  type        = string
}

variable "ssh_public_key_path" {
  description = "Path to your SSH public key file (e.g. ~/.ssh/id_rsa.pub)"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

# ─── Database ─────────────────────────────────────────────────────────────────
variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "taskee_prod"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "taskee_admin"
}

variable "db_password" {
  description = "PostgreSQL master password — use a strong password, stored in Secrets Manager"
  type        = string
  sensitive   = true
}

# ─── Application secrets ──────────────────────────────────────────────────────
variable "jwt_secret" {
  description = "JWT signing secret (generate: openssl rand -hex 64)"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT refresh token secret (generate: openssl rand -hex 64)"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key for Claude (optional — Groq is free)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "groq_api_key" {
  description = "Groq API key for Llama 3.3 70B (free at console.groq.com)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_host" {
  description = "SMTP server hostname (use SES: email-smtp.us-east-1.amazonaws.com)"
  type        = string
  default     = "email-smtp.us-east-1.amazonaws.com"
}

variable "smtp_port" {
  description = "SMTP port"
  type        = string
  default     = "587"
}

variable "smtp_user" {
  description = "SMTP username (SES SMTP credentials from AWS console)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_pass" {
  description = "SMTP password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_from" {
  description = "From email address (must be verified in SES)"
  type        = string
  default     = "noreply@taskee.app"
}
