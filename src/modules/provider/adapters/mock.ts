/**
 * MockMiningProvider — デモ・開発用の擬似マイニング設備
 *
 * ★ これは実際のハッシュ計算を一切行わない。★
 *   実際の Bitcoin 採掘には ASIC による SHA-256 の実計算が必要であり、
 *   ソフトウェアで代替することはできない。
 *   このアダプタは「プロバイダーと契約する前に、システム全体の動作を確認する」ためのもの。
 *
 * 生成する値の性質:
 *   - 時刻から決定的に生成する（同じ時刻なら同じ値。リロードで数値が飛ばない）
 *   - 日内変動（冷却効率の日周変化）＋短期ノイズ＋稀な瞬断を模す
 *   - accepted / rejected shares は経過時間に対して単調増加する
 *   - 温度・消費電力はハッシュレートと相関させる
 *
 * これにより「時間とともに変化する、それらしいが偽のデータ」が得られる。
 * UI には必ず DEMO バッジを出し、実データと誤認させないこと。
 */

import type { MiningProvider, PoolBalance, ProviderWorkerReading, Worker } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
  RawPayout,
} from "../interface";

/** 決定的ハッシュ（文字列 → 0〜1 の数値） */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 滑らかな擬似ノイズ（隣接する時刻で値が飛ばないように補間する） */
function smoothNoise(seed: string, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash01(`${seed}:${i}`);
  const b = hash01(`${seed}:${i + 1}`);
  // smoothstep で補間
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

export type MockWorkerSpec = {
  id: string;
  externalWorkerId: string;
  minerId: string;
  model: string;
  ratedHashrateThs: number;
  ratedEfficiencyJPerTh: number;
  /** 恒久的に停止しているワーカー（アラート表示の確認用） */
  forcedOffline?: boolean;
};

/**
 * 指定時刻におけるワーカーの実効ハッシュレート（TH/s）を決定的に返す。
 * 時系列グラフの生成にも使うため、公開関数にしてある。
 */
export function mockHashrateAt(spec: MockWorkerSpec, atMs: number): number {
  if (spec.forcedOffline) return 0;

  const hours = atMs / 3_600_000;

  // 日周変動: 気温が高い時間帯はサーマルスロットリングでわずかに低下する
  const diurnal = 1 - 0.025 * Math.sin(((atMs % 86_400_000) / 86_400_000) * Math.PI * 2);

  // 中期のうねり（数時間スケール）
  const swell = 0.97 + 0.06 * smoothNoise(`${spec.id}:swell`, hours / 3);

  // 短期ノイズ（数分スケール）
  const jitter = 0.985 + 0.03 * smoothNoise(`${spec.id}:jitter`, hours * 12);

  // 稀な瞬断（約 1% の時間帯でハッシュレートが大きく落ちる）
  const glitch = smoothNoise(`${spec.id}:glitch`, hours * 2);
  const dropFactor = glitch > 0.988 ? 0.15 : 1;

  return spec.ratedHashrateThs * diurnal * swell * jitter * dropFactor;
}

export function mockTemperatureAt(spec: MockWorkerSpec, atMs: number): number | null {
  if (spec.forcedOffline) return null;
  const load = mockHashrateAt(spec, atMs) / spec.ratedHashrateThs;
  const ambient = 22 + 6 * Math.sin(((atMs % 86_400_000) / 86_400_000) * Math.PI * 2);
  return Math.round((ambient + 38 * load + 3 * hash01(`${spec.id}:temp`)) * 10) / 10;
}

export function mockUptimeRate(spec: MockWorkerSpec): number {
  if (spec.forcedOffline) return 0;
  // ワーカーごとに 96.5%〜99.7% の範囲で固定
  return 0.965 + hash01(`${spec.id}:uptime`) * 0.032;
}

export class MockMiningProviderAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "MOCK" as const;
  /** ★ Mock は実データではない */
  readonly isLive = false;

  private readonly specs: MockWorkerSpec[];
  /** 劣化を模すプロバイダーかどうか（DEGRADED の見た目を確認するため） */
  private readonly degraded: boolean;

  constructor(provider: MiningProvider, workers: Worker[]) {
    this.id = provider.id;
    this.name = provider.name;
    this.degraded = provider.status === "DEGRADED";
    this.specs = workers
      .filter((w) => w.providerId === provider.id)
      .map((w) => ({
        id: w.id,
        externalWorkerId: w.externalWorkerId,
        minerId: w.minerId,
        model: w.model,
        ratedHashrateThs: w.ratedHashrateThs,
        ratedEfficiencyJPerTh: w.ratedEfficiencyJPerTh,
        forcedOffline: w.status === "OFFLINE",
      }));
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    const now = Date.now();
    // 劣化中のプロバイダーは応答が遅い（circuit breaker の動作確認になる）
    if (this.degraded) await new Promise((r) => setTimeout(r, 300));

    const readings: ProviderWorkerReading[] = this.specs.map((spec) => {
      const hashrate = mockHashrateAt(spec, now);
      const uptimeRate = mockUptimeRate(spec);
      // shares は経過秒数に比例して単調増加させる（巻き戻らない）
      const elapsedSec = Math.floor(now / 1000);
      const sharesPerSec = spec.ratedHashrateThs / 40;
      const accepted = Math.floor(elapsedSec * sharesPerSec * uptimeRate) % 1_000_000_000;
      const rejectRate = 0.002 + hash01(`${spec.id}:reject`) * 0.01;
      const rejected = Math.floor(accepted * rejectRate);

      const powerW =
        hashrate > 0 ? Math.round(hashrate * spec.ratedEfficiencyJPerTh) : 0;

      return {
        externalWorkerId: spec.externalWorkerId,
        minerId: spec.minerId,
        model: spec.model,
        hashrateThs: Math.round(hashrate * 100) / 100,
        ratedHashrateThs: spec.ratedHashrateThs,
        ratedEfficiencyJPerTh: spec.ratedEfficiencyJPerTh,
        acceptedShares: accepted,
        rejectedShares: rejected,
        temperatureC: mockTemperatureAt(spec, now),
        powerW,
        uptimeSec: Math.floor(uptimeRate * 30 * 86_400),
        poolStatus: spec.forcedOffline ? "disconnected" : "connected",
        workerStatus: spec.forcedOffline ? "OFFLINE" : hashrate > 0 ? "ACTIVE" : "OFFLINE",
        estimatedEarningsBtc: null,
      };
    });

    const total = readings.reduce((s, r) => s + r.hashrateThs, 0);

    return {
      readings,
      reportedTotalHashrateThs: Math.round(total * 100) / 100,
      fetchedAt: new Date(now).toISOString(),
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (this.degraded) {
      return {
        status: "DEGRADED",
        latencyMs: 4210,
        message: "デモ用に劣化状態を再現しています（上流の応答遅延）",
      };
    }
    return {
      status: "ONLINE",
      latencyMs: 12,
      message: "デモプロバイダー（実際のハッシュ計算は行っていません）",
    };
  }

  /**
   * デモ用の payout 履歴（★実データではない）。
   * 「プールが日次で払い出す」動きを決定的に再現し、配賦フローの動作確認に使う。
   * externalPayoutId は日付ベースで決定的 → 何度同期しても二重計上されない（冪等確認にも使える）。
   */
  async getPayoutHistory(sinceMs?: number): Promise<RawPayout[]> {
    const out: RawPayout[] = [];
    const now = Date.now();
    const from = sinceMs ?? now - 14 * 86_400_000;
    const totalRated = this.specs.reduce((s, w) => s + w.ratedHashrateThs, 0);

    // 日次 payout。00:30 UTC に前日分が払い出される想定
    for (let t = Math.ceil(from / 86_400_000) * 86_400_000; t <= now; t += 86_400_000) {
      const paidAt = t + 30 * 60_000;
      if (paidAt > now) break;
      const day = new Date(t).toISOString().slice(0, 10);
      // 500TH/s ≈ 0.000245 BTC/day を定格比で按分し、日ごとに ±6% 揺らす
      const noise = 0.94 + hash01(`${this.id}:payout:${day}`) * 0.12;
      const amount = (totalRated / 500) * 0.000245 * noise;
      if (amount <= 0) continue;
      out.push({
        externalPayoutId: `${this.id}:${day}`,
        amountBtc: amount.toFixed(8),
        paidAt: new Date(paidAt).toISOString(),
        txId: null,
      });
    }
    return out;
  }

  async getPoolBalance(): Promise<PoolBalance> {
    const payouts = await this.getPayoutHistory(Date.now() - 86_400_000);
    const unpaid = payouts.length > 0 ? 0 : (this.specs.reduce((s, w) => s + w.ratedHashrateThs, 0) / 500) * 0.000245 * 0.6;
    return {
      unpaidBtc: unpaid.toFixed(8),
      paidBtc: "0.02940000",
      source: `mock:${this.name}`,
      fetchedAt: new Date().toISOString(),
      isEstimate: false,
      isStale: false,
    };
  }

  /** 時系列グラフ用: 指定期間の合計ハッシュレートを決定的に生成する */
  seriesTotalHashrate(fromMs: number, toMs: number, points: number): Array<{ t: number; v: number }> {
    const step = (toMs - fromMs) / Math.max(1, points - 1);
    const out: Array<{ t: number; v: number }> = [];
    for (let i = 0; i < points; i++) {
      const t = fromMs + step * i;
      const v = this.specs.reduce((sum, spec) => sum + mockHashrateAt(spec, t), 0);
      out.push({ t, v: Math.round(v * 100) / 100 });
    }
    return out;
  }

  getSpecs(): MockWorkerSpec[] {
    return this.specs;
  }
}
