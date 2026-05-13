output "ec2_public_ip" {
  description = "EC2 Elastic IP — point api.yourdomain.com A record here"
  value       = aws_eip.backend.public_ip
}

output "rds_endpoint" {
  description = "RDS PostgreSQL hostname (private — accessible only from EC2)"
  value       = aws_db_instance.postgres.address
  sensitive   = true
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain (auto-used by Route 53)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_id" {
  description = "CloudFront distribution ID — needed for cache invalidation in CI/CD"
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_bucket" {
  description = "S3 bucket name for frontend static files"
  value       = aws_s3_bucket.frontend.bucket
}

output "uploads_bucket" {
  description = "S3 bucket name for user file uploads"
  value       = aws_s3_bucket.uploads.bucket
}

output "secret_arn" {
  description = "Secrets Manager ARN containing all app env vars"
  value       = aws_secretsmanager_secret.app_secrets.arn
}

output "route53_nameservers" {
  description = "Copy these 4 nameservers to your domain registrar (Namecheap / GoDaddy etc.)"
  value       = aws_route53_zone.main.name_servers
}

output "cost_estimate" {
  description = "Approximate monthly cost breakdown"
  value = {
    ec2_t3_micro     = "~$8.50/month"
    rds_t4g_micro    = "~$12.50/month"
    s3_cloudfront    = "~$1-2/month"
    route53          = "~$0.50/month"
    secrets_manager  = "~$0.40/month"
    total_estimated  = "~$23-24/month"
    note             = "First 12 months: EC2 t2.micro is FREE TIER eligible — saves $8.50/mo"
  }
}
