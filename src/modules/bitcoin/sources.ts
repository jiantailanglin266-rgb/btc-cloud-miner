/**
 * Bitcoin ネットワーク情報・価格のデータソース群
 *
 * 各ソースは「取得できなければ例外を投げる」だけの薄い関数。
 * フェイルオーバー・キャッシュ・stale 判定は service.ts が担当する。
 *
 * ★ 外部 API のレスポンスは一切信用しない。
 *   すべての数値を範囲検証し、異常値は例外にする。
 *   （難易度が 0 で返ってきたら収益が無限大になる、といった事故を防ぐ）
 */

import { config } from "@/lib/config";

export type NetworkRaw = {
  difficulty: number;
  networkHashrateThs: number;
  blockHeight: number;
  blockRewardBtc: number;
  blocksUntilAdjustment: number;
  estimatedAdjustmentRate: number;
  mempoolTxCount: number;
  recommendedFeeSatPerVb: number;
};

export type PriceRaw = {
  usd: number;
  jpy: number;
  change24hRate: number;
};

export type NetworkSource = {
  name: string;
  isLive: boolean;
  fetch: () => Promise<NetworkRaw>;
};

export type PriceSource = {
  name: string;
  isLive: boolean;
  fetch: () => Promise<PriceRaw>;
};

const TIMEOUT_MS = 5000;

class SourceError extends Error {}

function requireRange(name: string, value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new SourceError(`${name} の値が異常です: ${String(value)}`);
  }
  return n;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new SourceError(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new SourceError(`HTTP ${res.status} ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// ブロック報酬（半減期）
// ---------------------------------------------------------------------------

/**
 * ブロック高から報酬を計算する。
 * 21万ブロック（約4年）ごとに半減する。外部 API に頼らず自分で計算できる。
 */
export function blockRewardAt(height: number): number {
  const halvings = Math.floor(height / 210_000);
  if (halvings >= 64) return 0;
  return 50 / 2 ** halvings;
}

/** 難易度調整（2016ブロックごと）までの残ブロック数 */
export function blocksUntilAdjustment(height: number): number {
  return 2016 - (height % 2016);
}

// ---------------------------------------------------------------------------
// mempool.space 系 API
// ---------------------------------------------------------------------------

export function mempoolSource(baseUrl: string): NetworkSource {
  const base = baseUrl.replace(/\/$/, "");
  return {
    name: `mempool:${new URL(base).host}`,
    isLive: true,
    async fetch(): Promise<NetworkRaw> {
      const [difficultyAdj, tipHeight, hashrate, mempool, fees] = await Promise.all([
        getJson(`${base}/v1/difficulty-adjustment`),
        getText(`${base}/blocks/tip/height`),
        getJson(`${base}/v1/mining/hashrate/3d`),
        getJson(`${base}/mempool`),
        getJson(`${base}/v1/fees/recommended`),
      ]);

      const adj = difficultyAdj as Record<string, unknown>;
      const hr = hashrate as Record<string, unknown>;
      const mp = mempool as Record<string, unknown>;
      const fe = fees as Record<string, unknown>;

      const height = requireRange("blockHeight", tipHeight.trim(), 1, 100_000_000);
      // currentHashrate は H/s で返る
      const hashrateHs = requireRange("networkHashrate", hr.currentHashrate, 1e12, 1e30);

      return {
        difficulty: requireRange("difficulty", hr.currentDifficulty, 1, 1e18),
        networkHashrateThs: hashrateHs / 1e12,
        blockHeight: height,
        blockRewardBtc: blockRewardAt(height),
        blocksUntilAdjustment: requireRange(
          "blocksUntilAdjustment",
          adj.remainingBlocks,
          0,
          2016,
        ),
        // difficultyChange は % で返る（例 2.1）
        estimatedAdjustmentRate: requireRange("adjustment", adj.difficultyChange, -80, 400) / 100,
        mempoolTxCount: requireRange("mempoolTxCount", mp.count, 0, 100_000_000),
        recommendedFeeSatPerVb: requireRange("fee", fe.halfHourFee, 0, 100_000),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// blockchain.info 系 API（冗長化用）
// ---------------------------------------------------------------------------

export function blockchainInfoSource(baseUrl: string): NetworkSource {
  const base = baseUrl.replace(/\/$/, "");
  return {
    name: `blockchain-info:${new URL(base).host}`,
    isLive: true,
    async fetch(): Promise<NetworkRaw> {
      const stats = (await getJson(`${base}/stats?format=json`)) as Record<string, unknown>;
      const height = requireRange("blockHeight", stats.n_blocks_total, 1, 100_000_000);
      // hash_rate は GH/s
      const ghs = requireRange("networkHashrate", stats.hash_rate, 1, 1e18);

      return {
        difficulty: requireRange("difficulty", stats.difficulty, 1, 1e18),
        networkHashrateThs: ghs / 1000,
        blockHeight: height,
        blockRewardBtc: blockRewardAt(height),
        blocksUntilAdjustment: blocksUntilAdjustment(height),
        // このソースは調整予測を返さないため 0（＝不明）にする。推測で埋めない
        estimatedAdjustmentRate: 0,
        mempoolTxCount: 0,
        recommendedFeeSatPerVb: 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 自社フルノード（Bitcoin Core RPC）— 最も信頼できるソース
// ---------------------------------------------------------------------------

export function bitcoinRpcSource(url: string): NetworkSource {
  return {
    name: "bitcoin-core-rpc",
    isLive: true,
    async fetch(): Promise<NetworkRaw> {
      const auth =
        process.env.BITCOIN_RPC_USER && process.env.BITCOIN_RPC_PASSWORD
          ? "Basic " +
            Buffer.from(
              `${process.env.BITCOIN_RPC_USER}:${process.env.BITCOIN_RPC_PASSWORD}`,
            ).toString("base64")
          : null;

      const call = async (method: string, params: unknown[] = []) => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify({ jsonrpc: "1.0", id: "bcm", method, params }),
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new SourceError(`RPC ${method} が失敗しました: ${res.status}`);
        const json = (await res.json()) as { result?: unknown; error?: unknown };
        if (json.error) throw new SourceError(`RPC ${method}: ${JSON.stringify(json.error)}`);
        return json.result;
      };

      const info = (await call("getblockchaininfo")) as Record<string, unknown>;
      const netHashPs = await call("getnetworkhashps", [144]);
      const mempoolInfo = (await call("getmempoolinfo")) as Record<string, unknown>;

      const height = requireRange("blockHeight", info.blocks, 1, 100_000_000);
      return {
        difficulty: requireRange("difficulty", info.difficulty, 1, 1e18),
        networkHashrateThs: requireRange("networkHashrate", netHashPs, 1e12, 1e30) / 1e12,
        blockHeight: height,
        blockRewardBtc: blockRewardAt(height),
        blocksUntilAdjustment: blocksUntilAdjustment(height),
        estimatedAdjustmentRate: 0,
        mempoolTxCount: requireRange("mempoolTxCount", mempoolInfo.size, 0, 100_000_000),
        recommendedFeeSatPerVb: 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock ソース（デモ用）
// ---------------------------------------------------------------------------

/**
 * ★ 実データではない。★
 * デモ環境で「それらしい値」を返すためのもの。
 * 値は時刻から決定的に生成され、ゆっくり変化する（難易度は上昇傾向）。
 * UI では必ず DEMO バッジと併記すること。
 */
export const mockNetworkSource: NetworkSource = {
  name: "mock",
  isLive: false,
  async fetch(): Promise<NetworkRaw> {
    const now = Date.now();
    // 2026-08-08 時点を基準とし、そこからの経過日数で緩やかに変化させる
    const baseMs = Date.UTC(2026, 7, 8);
    const days = (now - baseMs) / 86_400_000;

    const baseHeight = 906_412;
    const height = Math.max(1, Math.floor(baseHeight + days * 144));
    // 難易度は 2 週間ごとにおよそ +1.5%
    const difficulty = 126.4e12 * Math.pow(1.015, days / 14);
    const networkHashrateThs = (difficulty * 2 ** 32) / 600 / 1e12;

    return {
      difficulty,
      networkHashrateThs,
      blockHeight: height,
      blockRewardBtc: blockRewardAt(height),
      blocksUntilAdjustment: blocksUntilAdjustment(height),
      estimatedAdjustmentRate: 0.021,
      mempoolTxCount: 18_000 + Math.floor((Math.sin(days * 2.7) + 1) * 6000),
      recommendedFeeSatPerVb: 3 + Math.floor((Math.sin(days * 3.1) + 1) * 4),
    };
  },
};

export const mockPriceSource: PriceSource = {
  name: "mock",
  isLive: false,
  async fetch(): Promise<PriceRaw> {
    const now = Date.now();
    const baseMs = Date.UTC(2026, 7, 8);
    const days = (now - baseMs) / 86_400_000;
    // 決定的な擬似変動（実勢とは一致しない）
    const usd = 95_000 * (1 + 0.06 * Math.sin(days / 9) + 0.02 * Math.sin(days * 1.7));
    const prev = 95_000 * (1 + 0.06 * Math.sin((days - 1) / 9) + 0.02 * Math.sin((days - 1) * 1.7));
    return {
      usd: Math.round(usd),
      jpy: Math.round(usd * 152),
      change24hRate: (usd - prev) / prev,
    };
  },
};

// ---------------------------------------------------------------------------
// 価格ソース（CoinGecko 互換）
// ---------------------------------------------------------------------------

export function coingeckoPriceSource(baseUrl: string): PriceSource {
  const base = baseUrl.replace(/\/$/, "");
  return {
    name: `price:${new URL(base).host}`,
    isLive: true,
    async fetch(): Promise<PriceRaw> {
      const json = (await getJson(
        `${base}/simple/price?ids=bitcoin&vs_currencies=usd,jpy&include_24hr_change=true`,
      )) as Record<string, Record<string, unknown>>;
      const b = json.bitcoin;
      if (!b) throw new SourceError("価格データが取得できませんでした");
      return {
        usd: requireRange("usd", b.usd, 1, 100_000_000),
        jpy: requireRange("jpy", b.jpy, 1, 10_000_000_000),
        change24hRate: requireRange("change24h", b.usd_24h_change ?? 0, -100, 1000) / 100,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 構成からソース一覧を組み立てる
// ---------------------------------------------------------------------------

export function buildNetworkSources(): NetworkSource[] {
  const sources: NetworkSource[] = [];
  // 自社ノードが最優先
  if (config.bitcoin.rpcUrl) sources.push(bitcoinRpcSource(config.bitcoin.rpcUrl));
  for (const url of config.bitcoin.sources) {
    try {
      sources.push(
        url.includes("blockchain.info") ? blockchainInfoSource(url) : mempoolSource(url),
      );
    } catch {
      // URL が不正な場合はそのソースだけ無視する（起動は止めない）
      console.warn(`[bitcoin] 不正なソース URL のため無視します: ${url}`);
    }
  }
  // 最後は必ず Mock（全滅時にサービスが止まらないようにする）
  sources.push(mockNetworkSource);
  return sources;
}

export function buildPriceSources(): PriceSource[] {
  const sources: PriceSource[] = [];
  for (const url of config.price.sources) {
    try {
      sources.push(coingeckoPriceSource(url));
    } catch {
      console.warn(`[price] 不正なソース URL のため無視します: ${url}`);
    }
  }
  sources.push(mockPriceSource);
  return sources;
}
