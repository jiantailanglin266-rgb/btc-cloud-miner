variable "name" {
  description = "リソース名のプレフィックス"
  type        = string
  default     = "btc-cloud-miner"
}

variable "environment" {
  description = "staging | production"
  type        = string
}

variable "region" {
  description = "AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "app_image" {
  description = "ECR のイメージ URI（タグ付き）"
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}
