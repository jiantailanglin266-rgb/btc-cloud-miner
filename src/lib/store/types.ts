/**
 * Store インターフェース（Repository パターン）
 *
 * アプリのビジネスロジックはこのインターフェースにのみ依存する。
 * 実装は 2 つ:
 *   - memory.ts : インメモリ（デモ・開発・テスト用）
 *   - prisma.ts : PostgreSQL（本番）
 *
 * ★ すべてのメソッドは第1引数に tenantId を取る。
 *   これはテナント越境バグを「呼び忘れたらコンパイルエラー」にするための設計。
 */

import type {
  AiInsight,
  Alert,
  DeadLetterJob,
  ProviderCertification,
  AuditLog,
  Contract,
  Earning,
  HashrateAllocation,
  Incident,
  LedgerEntry,
  MiningProvider,
  Notification,
  Plan,
  PoolPayout,
  RawProviderSnapshot,
  Session,
  SupportTicket,
  Tenant,
  TenantSettings,
  User,
  UserCredentials,
  WalletAccount,
  WalletAddress,
  Withdrawal,
  Worker,
  WorkerSnapshot,
} from "@/types";

export type Store = {
  readonly kind: "memory" | "prisma";

  // --- テナント -----------------------------------------------------------
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  getTenantById(id: string): Promise<Tenant | null>;
  getDefaultTenant(): Promise<Tenant>;
  listTenants(): Promise<Tenant[]>;
  getTenantSettings(tenantId: string): Promise<TenantSettings>;
  updateTenantSettings(
    tenantId: string,
    patch: Partial<TenantSettings>,
  ): Promise<TenantSettings>;

  // --- ユーザー -----------------------------------------------------------
  getUserByEmail(tenantId: string, email: string): Promise<User | null>;
  getUserById(tenantId: string, id: string): Promise<User | null>;
  /** セッション検証用。テナント跨ぎで引くのはここだけ（tokenHash が一意なため安全） */
  getUserByIdAnyTenant(id: string): Promise<User | null>;
  listUsers(
    tenantId: string,
    filter?: { q?: string; role?: string; status?: string },
  ): Promise<User[]>;
  createUser(user: User, credentials: UserCredentials): Promise<User>;
  updateUser(tenantId: string, id: string, patch: Partial<User>): Promise<User | null>;

  getCredentials(userId: string): Promise<UserCredentials | null>;
  updateCredentials(
    userId: string,
    patch: Partial<UserCredentials>,
  ): Promise<UserCredentials | null>;

  // --- セッション ---------------------------------------------------------
  createSession(session: Session): Promise<Session>;
  getSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  listSessionsByUser(userId: string): Promise<Session[]>;
  updateSession(id: string, patch: Partial<Session>): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;

  // --- プラン・契約 -------------------------------------------------------
  listPlans(tenantId: string): Promise<Plan[]>;
  getPlan(tenantId: string, id: string): Promise<Plan | null>;
  upsertPlan(plan: Plan): Promise<Plan>;
  listContracts(tenantId: string, userId?: string): Promise<Contract[]>;
  getContract(tenantId: string, id: string): Promise<Contract | null>;
  createContract(contract: Contract): Promise<Contract>;
  updateContract(
    tenantId: string,
    id: string,
    patch: Partial<Contract>,
  ): Promise<Contract | null>;
  listAllocations(tenantId: string, contractId?: string): Promise<HashrateAllocation[]>;
  createAllocation(allocation: HashrateAllocation): Promise<HashrateAllocation>;

  // --- プロバイダー・ワーカー ---------------------------------------------
  listProviders(tenantId: string): Promise<MiningProvider[]>;
  getProvider(tenantId: string, id: string): Promise<MiningProvider | null>;
  upsertProvider(provider: MiningProvider): Promise<MiningProvider>;
  updateProvider(
    tenantId: string,
    id: string,
    patch: Partial<MiningProvider>,
  ): Promise<MiningProvider | null>;

  listWorkers(tenantId: string, filter?: { providerId?: string }): Promise<Worker[]>;
  getWorker(tenantId: string, id: string): Promise<Worker | null>;
  upsertWorkers(tenantId: string, workers: Worker[]): Promise<void>;

  saveSnapshots(tenantId: string, snapshots: WorkerSnapshot[]): Promise<void>;
  /** bucketAt の降順。limit 件 */
  listSnapshots(
    tenantId: string,
    filter: { workerId?: string; fromMs?: number; limit?: number },
  ): Promise<WorkerSnapshot[]>;
  latestSnapshotByWorker(tenantId: string): Promise<Map<string, WorkerSnapshot>>;

  // --- ウォレット ---------------------------------------------------------
  getWalletAccount(tenantId: string, userId: string): Promise<WalletAccount>;
  listLedgerEntries(tenantId: string, accountId: string): Promise<LedgerEntry[]>;
  /**
   * 元帳への追記。
   * ★ 同一トランザクションで複数行を書くこと（片方だけ入る状態を作らない）。
   * idempotencyKey が既存と重複したら false を返し、何も書かない。
   */
  appendLedger(tenantId: string, entries: LedgerEntry[]): Promise<boolean>;

  listAddresses(tenantId: string, userId: string): Promise<WalletAddress[]>;
  getAddress(tenantId: string, id: string): Promise<WalletAddress | null>;
  createAddress(address: WalletAddress): Promise<WalletAddress>;
  deleteAddress(tenantId: string, id: string): Promise<void>;

  listWithdrawals(
    tenantId: string,
    filter?: { userId?: string; status?: string },
  ): Promise<Withdrawal[]>;
  getWithdrawal(tenantId: string, id: string): Promise<Withdrawal | null>;
  getWithdrawalByIdempotencyKey(tenantId: string, key: string): Promise<Withdrawal | null>;
  createWithdrawal(withdrawal: Withdrawal): Promise<Withdrawal>;
  updateWithdrawal(
    tenantId: string,
    id: string,
    patch: Partial<Withdrawal>,
  ): Promise<Withdrawal | null>;

  listEarnings(
    tenantId: string,
    userId: string,
    fromMs?: number,
  ): Promise<Earning[]>;
  createEarnings(tenantId: string, earnings: Earning[]): Promise<void>;

  // --- Pool Payout（実払い出し） -------------------------------------------
  /**
   * payout を保存する。(providerId, externalPayoutId) が既存なら false（冪等）。
   */
  insertPayout(payout: PoolPayout): Promise<boolean>;
  listPayouts(
    tenantId: string,
    filter?: { allocationStatus?: PoolPayout["allocationStatus"]; limit?: number },
  ): Promise<PoolPayout[]>;
  getPayout(tenantId: string, id: string): Promise<PoolPayout | null>;
  updatePayout(
    tenantId: string,
    id: string,
    patch: Partial<PoolPayout>,
  ): Promise<PoolPayout | null>;

  // --- 監視アラート ---------------------------------------------------------
  /** 同種・同対象の未確認アラートが既にあれば重複作成しない。作成したら true */
  insertAlert(alert: Alert): Promise<boolean>;
  listAlerts(
    tenantId: string,
    filter?: { unacknowledgedOnly?: boolean; limit?: number },
  ): Promise<Alert[]>;
  acknowledgeAlert(tenantId: string, id: string, userId: string): Promise<void>;

  // --- Raw プロバイダースナップショット（デバッグ用・sanitize 済み） -------
  insertRawSnapshot(snapshot: RawProviderSnapshot): Promise<void>;
  listRawSnapshots(
    tenantId: string,
    providerId?: string,
    limit?: number,
  ): Promise<RawProviderSnapshot[]>;

  // --- 同期ロック（TTL 付き。二重同期・二重 payout の防止） -----------------
  /** 取得できたら true。他者が有効なロックを保持中なら false */
  acquireLock(key: string, holder: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string, holder: string): Promise<void>;

  // --- Provider Certification（実疎通の証明記録） ---------------------------
  insertCertification(cert: ProviderCertification): Promise<void>;
  /** プロバイダーごとの最新 certification（providerId 省略で全件の最新順） */
  listCertifications(
    tenantId: string,
    providerId?: string,
    limit?: number,
  ): Promise<ProviderCertification[]>;

  // --- Dead Letter Job（最大試行後の失敗記録） ------------------------------
  insertDeadLetter(job: DeadLetterJob): Promise<void>;
  listDeadLetters(
    tenantId: string,
    filter?: { status?: DeadLetterJob["status"]; limit?: number },
  ): Promise<DeadLetterJob[]>;
  updateDeadLetter(
    tenantId: string,
    id: string,
    patch: Partial<DeadLetterJob>,
  ): Promise<DeadLetterJob | null>;

  // --- 通知・サポート・障害 -----------------------------------------------
  listNotifications(tenantId: string, userId: string): Promise<Notification[]>;
  createNotification(notification: Notification): Promise<Notification>;
  markNotificationRead(tenantId: string, userId: string, id: string): Promise<void>;
  markAllNotificationsRead(tenantId: string, userId: string): Promise<void>;

  listTickets(tenantId: string, userId?: string): Promise<SupportTicket[]>;
  getTicket(tenantId: string, id: string): Promise<SupportTicket | null>;
  createTicket(ticket: SupportTicket): Promise<SupportTicket>;
  updateTicket(
    tenantId: string,
    id: string,
    patch: Partial<SupportTicket>,
  ): Promise<SupportTicket | null>;

  listIncidents(tenantId: string): Promise<Incident[]>;
  createIncident(incident: Incident): Promise<Incident>;
  updateIncident(
    tenantId: string,
    id: string,
    patch: Partial<Incident>,
  ): Promise<Incident | null>;

  // --- 監査・AI -----------------------------------------------------------
  appendAuditLog(log: AuditLog): Promise<void>;
  listAuditLogs(
    tenantId: string,
    filter?: { actorUserId?: string; action?: string; limit?: number },
  ): Promise<AuditLog[]>;

  listInsights(tenantId: string): Promise<AiInsight[]>;
  replaceInsights(tenantId: string, insights: AiInsight[]): Promise<void>;
};
