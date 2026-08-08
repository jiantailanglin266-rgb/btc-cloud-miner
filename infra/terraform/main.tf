# BTC CLOUD MINER — AWS インフラ骨格（ARCHITECTURE.md §6 対応）
#
# これは「構成の写経を減らすための骨格」であり、そのまま apply できる完成品ではない。
# 各 module のリソース定義を環境に合わせて実装すること。
# 機密値（DB パスワード等）は tfvars に書かず、Secrets Manager + data source で参照する。

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # 状態ファイルはリモートに置く（ローカル state を共有しない）
  # backend "s3" {
  #   bucket         = "btc-cloud-miner-tfstate"
  #   key            = "production/terraform.tfstate"
  #   region         = "ap-northeast-1"
  #   dynamodb_table = "btc-cloud-miner-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region
}

# --- ネットワーク: VPC / サブネット / NAT / セキュリティグループ ---------------
module "network" {
  source   = "./modules/network"
  name     = var.name
  vpc_cidr = "10.0.0.0/16"
}

# --- データベース: RDS PostgreSQL 16（Multi-AZ / PITR / 暗号化） --------------
module "database" {
  source             = "./modules/database"
  name               = var.name
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  instance_class     = var.db_instance_class
  multi_az           = var.environment == "production"
  # RPO 5分 / RTO 1時間（DATABASE.md §6）
  backup_retention_days = 35
}

# --- キャッシュ: ElastiCache Redis ------------------------------------------
module "cache" {
  source             = "./modules/cache"
  name               = var.name
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  node_type          = var.redis_node_type
}

# --- シークレット: Secrets Manager + KMS ------------------------------------
module "secrets" {
  source = "./modules/secrets"
  name   = var.name
  # ENCRYPTION_KEY / provider API keys / custody credentials をここで管理する
}

# --- アプリ: ECS Fargate（app / worker / mining-gateway）+ ALB ---------------
module "app" {
  source             = "./modules/app"
  name               = var.name
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = var.app_image
  app_count          = var.environment == "production" ? 2 : 1
  # Stratum 常時接続用の常駐サービス（サーバーレス不可のため Fargate 常駐）
  gateway_count      = var.environment == "production" ? 2 : 0
  database_url_arn   = module.database.connection_secret_arn
  redis_url          = module.cache.endpoint
  secrets_kms_arn    = module.secrets.kms_key_arn
  # SSE のため ALB idle timeout は 60s 以上（heartbeat は 25s 間隔）
  alb_idle_timeout   = 120
}
