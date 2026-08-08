/**
 * StratumAdapter — マイニングプールとの Stratum 接続（Backend Mining Gateway 側）
 *
 * ★ 重要な事実の確認 ★
 *   Stratum は「プールが仕事(job)を配り、マイナーが計算結果(share)を返す」プロトコル。
 *   本システムはハッシュ計算装置（ASIC）ではないため、**share を提出することはできない**。
 *   したがってこのアダプタの役割は「採掘」ではなく、
 *
 *      ・プールへの接続が生きているか
 *      ・job が正常に配信されているか（＝プールが機能しているか）
 *      ・プールが要求する難易度（vardiff）
 *      ・接続の切断・再接続の履歴
 *
 *   を監視することにある。実際の share 提出は、契約先の ASIC が行う。
 *
 * ★ ブラウザから直接 Stratum を叩かせない ★
 *   Stratum は TCP の永続接続で、認証情報（worker/password）を平文で送る。
 *   フロントエンドに置けば認証情報が露出し、他人のワーカー名で接続もできてしまう。
 *   必ずこのサーバー側モジュール（Backend Mining Gateway）を経由させる。
 *
 * Stratum V2 について:
 *   V2 は暗号化・改ざん耐性・job 選択の分散化を備えた新版。
 *   本実装は V1 のメッセージ処理を `handleMessage` に閉じ込めてあるため、
 *   V2 対応時は `StratumV2Session` を追加して `createSession` を分岐させればよい。
 */

import net from "node:net";
import tls from "node:tls";
import type { MiningProvider } from "@/types";
import type {
  MiningProviderAdapter,
  ProviderFetchResult,
  ProviderHealthResult,
} from "../interface";
import { config } from "@/lib/config";

export type StratumState = {
  connected: boolean;
  authorized: boolean;
  /** プールが指示している難易度（vardiff） */
  difficulty: number | null;
  /** 受信した job の数 */
  jobsReceived: number;
  lastJobAt: string | null;
  connectedAt: string | null;
  reconnectCount: number;
  lastError: string | null;
};

type JsonRpcMessage = {
  id?: number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type StratumEndpoint = {
  host: string;
  port: number;
  tls: boolean;
  worker: string;
  password: string;
};

export function parseStratumUrl(url: string): { host: string; port: number; tls: boolean } {
  // stratum+tcp://host:port / stratum+ssl://host:port
  const m = url.match(/^stratum\+(tcp|ssl|tls):\/\/([^:/]+):(\d+)/i);
  if (!m) throw new Error(`Stratum URL の形式が不正です: ${url}`);
  return { host: m[2], port: Number(m[3]), tls: m[1].toLowerCase() !== "tcp" };
}

/**
 * Stratum V1 の監視セッション。
 * 1 プールにつき 1 インスタンス。切断されたら指数バックオフで再接続する。
 */
export class StratumV1Session {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = "";
  private nextId = 1;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1000;
  private closed = false;

  readonly state: StratumState = {
    connected: false,
    authorized: false,
    difficulty: null,
    jobsReceived: 0,
    lastJobAt: null,
    connectedAt: null,
    reconnectCount: 0,
    lastError: null,
  };

  constructor(private readonly endpoint: StratumEndpoint) {}

  connect(): void {
    if (this.closed) return;
    this.cleanupSocket();

    const onConnect = () => {
      this.state.connected = true;
      this.state.connectedAt = new Date().toISOString();
      this.state.lastError = null;
      this.reconnectDelayMs = 1000; // 成功したらバックオフをリセット
      this.send("mining.subscribe", ["btc-cloud-miner-gateway/1.0"]);
      this.send("mining.authorize", [this.endpoint.worker, this.endpoint.password]);
    };

    try {
      this.socket = this.endpoint.tls
        ? tls.connect(
            { host: this.endpoint.host, port: this.endpoint.port, servername: this.endpoint.host },
            onConnect,
          )
        : net.connect({ host: this.endpoint.host, port: this.endpoint.port }, onConnect);
    } catch (err) {
      this.onError(err);
      return;
    }

    this.socket.setEncoding("utf8");
    this.socket.setKeepAlive(true, 30_000);
    this.socket.setTimeout(120_000);

    this.socket.on("data", (chunk: string) => this.onData(chunk));
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("timeout", () => this.onError(new Error("Stratum 接続がタイムアウトしました")));
    this.socket.on("close", () => {
      this.state.connected = false;
      this.state.authorized = false;
      this.scheduleReconnect();
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.cleanupSocket();
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = "";
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.state.reconnectCount++;
    const delay = this.reconnectDelayMs;
    // 指数バックオフ（最大 60 秒）。ジッタで再接続の集中を避ける
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        this.connect();
      },
      delay + Math.floor(Math.random() * 500),
    );
  }

  private onError(err: unknown): void {
    this.state.lastError = err instanceof Error ? err.message : String(err);
    this.state.connected = false;
    this.state.authorized = false;
  }

  private send(method: string, params: unknown[]): void {
    if (!this.socket) return;
    const msg = JSON.stringify({ id: this.nextId++, method, params });
    this.socket.write(`${msg}\n`);
  }

  /** Stratum は「1 行 1 JSON」。行が分割されて届くのでバッファリングする */
  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // プールが壊れた行を送ってきても接続は維持する
        this.state.lastError = "受信データの解析に失敗しました";
      }
    }
    // 異常に大きいバッファは破棄する（メモリ枯渇の防止）
    if (this.buffer.length > 1_000_000) this.buffer = "";
  }

  /** ★ Stratum V2 対応時は、ここを差し替える */
  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.method === "mining.notify") {
      this.state.jobsReceived++;
      this.state.lastJobAt = new Date().toISOString();
      return;
    }
    if (msg.method === "mining.set_difficulty" && Array.isArray(msg.params)) {
      const d = Number((msg.params as unknown[])[0]);
      if (Number.isFinite(d) && d > 0) this.state.difficulty = d;
      return;
    }
    // authorize の応答（id 付き・result が boolean）
    if (msg.id !== undefined && typeof msg.result === "boolean") {
      if (msg.result) this.state.authorized = true;
      else this.state.lastError = "プールの認証に失敗しました（worker/password を確認）";
    }
    if (msg.error) {
      this.state.lastError = JSON.stringify(msg.error).slice(0, 200);
    }
  }
}

/**
 * Stratum を監視するアダプタ。
 * ワーカー統計は Stratum からは取得できない（プロトコルにその概念がない）ため、
 * fetchWorkers は空を返す。統計は PoolRestAdapter または Provider API から取る。
 */
export class StratumAdapter implements MiningProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "STRATUM" as const;
  readonly isLive = true;

  private session: StratumV1Session | null = null;

  constructor(private readonly provider: MiningProvider) {
    this.id = provider.id;
    this.name = provider.name;
  }

  /** 接続を開始する（Backend Mining Gateway の起動時に呼ぶ） */
  start(): void {
    if (this.session) return;
    const url = this.provider.endpoint ?? config.stratum.url;
    if (!url || !config.stratum.worker) {
      throw new Error(
        "Stratum の接続情報が設定されていません（STRATUM_URL / STRATUM_WORKER）",
      );
    }
    if (config.stratum.version !== "v1") {
      throw new Error(
        `Stratum ${config.stratum.version} は未実装です。現在対応しているのは v1 のみです。`,
      );
    }
    const { host, port, tls: useTls } = parseStratumUrl(url);
    this.session = new StratumV1Session({
      host,
      port,
      tls: useTls,
      worker: config.stratum.worker,
      password: config.stratum.password ?? "x",
    });
    this.session.connect();
  }

  stop(): void {
    this.session?.close();
    this.session = null;
  }

  getState(): StratumState | null {
    return this.session?.state ?? null;
  }

  async fetchWorkers(): Promise<ProviderFetchResult> {
    // Stratum プロトコルにはワーカー統計の取得手段が無い。
    // 「取れないものを取れるように見せない」ため、空配列を返す。
    return {
      readings: [],
      reportedTotalHashrateThs: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const s = this.session?.state;
    if (!s) {
      return { status: "OFFLINE", latencyMs: 0, message: "Stratum セッションが未開始です" };
    }
    if (!s.connected) {
      return { status: "OFFLINE", latencyMs: 0, message: s.lastError ?? "未接続" };
    }
    if (!s.authorized) {
      return { status: "DEGRADED", latencyMs: 0, message: "接続済みだが未認証です" };
    }
    // job が長時間来ていない = プール側の異常
    const lastJobAgeMs = s.lastJobAt ? Date.now() - new Date(s.lastJobAt).getTime() : Infinity;
    if (lastJobAgeMs > 300_000) {
      return {
        status: "DEGRADED",
        latencyMs: 0,
        message: `${Math.floor(lastJobAgeMs / 60000)} 分間 job が配信されていません`,
      };
    }
    return { status: "ONLINE", latencyMs: 0, message: null };
  }
}
