output "alb_dns_name" {
  description = "ALB の DNS 名（Route53 / CloudFront のオリジンに設定する）"
  value       = module.app.alb_dns_name
}

output "database_endpoint" {
  value     = module.database.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = module.cache.endpoint
}
