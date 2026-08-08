# ER図

```mermaid
erDiagram
    TENANTS ||--o{ TENANT_DOMAINS : has
    TENANTS ||--|| TENANT_SETTINGS : configures
    TENANTS ||--o{ ORGANIZATIONS : contains
    TENANTS ||--o{ USERS : contains
    TENANTS ||--o{ PLANS : defines
    TENANTS ||--o{ MINING_PROVIDERS : connects
    TENANTS ||--o{ INCIDENTS : reports

    ORGANIZATIONS ||--o{ USERS : employs

    USERS ||--|| USER_CREDENTIALS : secures
    USERS ||--o{ SESSIONS : opens
    USERS ||--|| KYC_RECORDS : verifies
    USERS ||--o{ CONTRACTS : signs
    USERS ||--|| WALLET_ACCOUNTS : owns
    USERS ||--o{ WALLET_ADDRESSES : registers
    USERS ||--o{ WITHDRAWALS : requests
    USERS ||--o{ EARNINGS : receives
    USERS ||--o{ NOTIFICATIONS : gets
    USERS ||--o{ SUPPORT_TICKETS : opens
    USERS ||--o{ AUDIT_LOGS : triggers

    PLANS ||--o{ CONTRACTS : instantiates
    CONTRACTS ||--o{ HASHRATE_ALLOCATIONS : allocates
    CONTRACTS ||--o{ EARNINGS : generates
    CONTRACTS ||--o{ INVOICES : bills

    MINING_PROVIDERS ||--o{ WORKERS : operates
    MINING_PROVIDERS ||--o{ MINING_POOLS : uses
    MINING_PROVIDERS ||--o{ API_HEALTH_CHECKS : monitored_by

    WORKERS ||--o{ WORKER_SNAPSHOTS : reports
    WORKERS ||--o{ WORKER_STATS_HOURLY : rolls_up
    WORKERS ||--o{ WORKER_STATS_DAILY : rolls_up
    WORKERS ||--o{ HASHRATE_ALLOCATIONS : assigned_to
    WORKERS ||--o{ AI_INSIGHTS : analyzed_by

    WALLET_ACCOUNTS ||--o{ LEDGER_ENTRIES : records
    WALLET_ADDRESSES ||--o{ WITHDRAWALS : destination
    WITHDRAWALS ||--o{ WITHDRAWAL_APPROVALS : approved_by
    WITHDRAWALS ||--o{ LEDGER_ENTRIES : moves

    SUPPORT_TICKETS ||--o{ SUPPORT_MESSAGES : contains

    TENANTS {
        uuid id PK
        text slug UK
        text name
        enum status
        timestamptz created_at
    }

    TENANT_SETTINGS {
        uuid tenant_id PK
        text brand_name
        text logo_url
        text color_primary
        text color_accent
        numeric platform_fee_rate
        numeric pool_fee_rate
        numeric electricity_price_kwh
        numeric min_withdrawal_btc
        numeric withdrawal_fee_btc
        numeric withdrawal_auto_approve_limit_btc
        jsonb feature_flags
    }

    USERS {
        uuid id PK
        uuid tenant_id FK
        uuid organization_id FK
        citext email
        text name
        enum role
        enum status
        bool two_factor_enabled
        timestamptz last_login_at
        inet last_login_ip
        timestamptz deleted_at
    }

    USER_CREDENTIALS {
        uuid user_id PK
        text password_hash
        text totp_secret_enc
        text recovery_codes_enc
        int failed_attempts
        timestamptz locked_until
    }

    SESSIONS {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz two_factor_verified_at
        timestamptz expires_at
        inet ip
        text user_agent
    }

    PLANS {
        uuid id PK
        uuid tenant_id FK
        text name
        numeric hashrate_ths
        int term_days
        numeric price_usd
        numeric pool_fee_rate
        numeric platform_fee_rate
        numeric electricity_price_kwh
        bool active
    }

    CONTRACTS {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        uuid plan_id FK
        numeric hashrate_ths
        enum status
        timestamptz starts_at
        timestamptz ends_at
        bool auto_renew
    }

    MINING_PROVIDERS {
        uuid id PK
        uuid tenant_id FK
        enum kind
        text name
        text endpoint
        text credentials_ref
        enum status
        timestamptz last_ok_at
        int consecutive_failures
        int priority
        bool enabled
    }

    WORKERS {
        uuid id PK
        uuid tenant_id FK
        uuid provider_id FK
        text external_worker_id
        text miner_id
        text model
        numeric rated_hashrate_ths
        numeric rated_efficiency_j_per_th
        enum status
        timestamptz last_seen_at
    }

    WORKER_SNAPSHOTS {
        bigserial id PK
        uuid worker_id FK
        timestamptz bucket_at
        numeric hashrate_ths
        bigint accepted_shares
        bigint rejected_shares
        numeric temperature_c
        numeric power_w
        bigint uptime_sec
        text pool_status
        text worker_status
    }

    LEDGER_ENTRIES {
        bigserial id PK
        uuid account_id FK
        enum entry_type
        enum bucket
        numeric amount_btc
        text ref_type
        uuid ref_id
        text idempotency_key
        timestamptz created_at
    }

    WITHDRAWALS {
        uuid id PK
        uuid user_id FK
        uuid address_id FK
        numeric amount_btc
        numeric fee_btc
        numeric net_btc
        enum status
        int risk_score
        jsonb risk_reasons
        text tx_id
        int confirmations
        text idempotency_key
    }

    AUDIT_LOGS {
        bigserial id PK
        uuid tenant_id
        uuid actor_user_id
        text actor_role
        text action
        text target_type
        text target_id
        jsonb before
        jsonb after
        inet ip
        enum result
        timestamptz created_at
    }
```

## 残高の考え方（重要）

`WALLET_ACCOUNTS` は残高カラムを持たない。残高は必ず `LEDGER_ENTRIES` の合計で導出する。

```
available = SUM(amount_btc) WHERE account_id = ? AND bucket = 'AVAILABLE'
locked    = SUM(amount_btc) WHERE account_id = ? AND bucket = 'LOCKED'
```

出金申請時は2行を同一トランザクションで書く（合計はゼロ＝資産が増減しない）:

| entry_type | bucket | amount |
|---|---|---|
| `WITHDRAWAL_LOCK` | `AVAILABLE` | `-0.01` |
| `WITHDRAWAL_LOCK` | `LOCKED` | `+0.01` |

却下時は逆仕訳（`WITHDRAWAL_REVERSE`）、送金完了時は `LOCKED` から `-0.01`（`WITHDRAWAL_SETTLE`）。
この方式なら「残高が消える」バグが構造的に起きない。
