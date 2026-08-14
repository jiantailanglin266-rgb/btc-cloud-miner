/**
 * Provider Certification（フェーズ4）
 *
 * 実プロバイダー疎通の証明を記録する。
 * 「このコードバージョン・この環境で・この時刻に・実 API と疎通できた」という
 * 監査可能な事実を残す。LIVE VERIFIED の判定材料になる。
 *
 * ★ Secret（トークン・アカウント名の平文）は保存しない。末尾4桁マスクのみ。
 */

import type { MiningProvider, ProviderCertification, TestConnectionResult } from "@/types";
import { getStore } from "@/lib/store";
import { newId } from "@/lib/crypto";
import { toSat } from "@/lib/decimal";
import { maskSecret, resolveProviderSecret } from "./adapters/secret";

/** package.json の version（ビルド時に固定される） */
import { version as CODE_VERSION } from "../../../package.json";

export async function recordCertification(
  tenantId: string,
  provider: MiningProvider,
  result: TestConnectionResult,
): Promise<ProviderCertification> {
  const store = await getStore();

  // account 識別子はマスクした形でのみ保存する
  const secret = resolveProviderSecret(provider);
  const masked = result.info?.account
    ? maskSecret(result.info.account)
    : maskSecret(secret);

  const cert: ProviderCertification = {
    id: newId(),
    tenantId,
    providerId: provider.id,
    providerKind: provider.kind,
    accountIdentifierMasked: masked,
    testedAt: new Date().toISOString(),
    workerCount: result.info?.workerCount ?? null,
    hashrateThs: result.info?.currentHashrateThs ?? null,
    balanceSatoshi: result.info?.unpaidBtc ? toSat(result.info.unpaidBtc).toString() : null,
    latencyMs: result.latencyMs,
    result: result.code,
    codeVersion: CODE_VERSION,
    environment: process.env.NODE_ENV ?? "development",
  };
  await store.insertCertification(cert);
  return cert;
}

/**
 * プロバイダーが「実疎通済み（certified）」か。
 * 条件: 直近 7 日以内に CONNECTED の certification があること。
 * Allocation Safety Gate（フェーズ9）の判定に使う。
 * ★ MOCK プロバイダーはデモ用に certified 扱い（本番では demo guard が MOCK 自体を防ぐ）。
 */
export async function isProviderCertified(
  tenantId: string,
  provider: MiningProvider,
): Promise<boolean> {
  if (provider.kind === "MOCK") return true;
  const store = await getStore();
  const certs = await store.listCertifications(tenantId, provider.id, 5);
  const weekAgo = Date.now() - 7 * 86_400_000;
  return certs.some(
    (c) => c.result === "CONNECTED" && new Date(c.testedAt).getTime() >= weekAgo,
  );
}
