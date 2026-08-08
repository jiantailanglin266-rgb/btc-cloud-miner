/**
 * Bitcoin アドレスの検証
 *
 * ★ なぜ形式チェックだけでは不十分か ★
 *   BTC の送金は取り消せない。1文字打ち間違えたアドレスへ送ると資産は永久に失われる。
 *   正規表現によるパターン一致だけでは、打ち間違いを検出できない。
 *   Bitcoin のアドレスには**チェックサム**が組み込まれているので、必ずそれを検証する。
 *
 *   - Base58Check（1... / 3... で始まる従来形式）: SHA-256 を2回かけた先頭4バイト
 *   - Bech32 / Bech32m（bc1... で始まる SegWit 形式）: BCH 符号による検査
 *
 * 依存ライブラリを使わず自前実装している理由: 検証ロジックを監査可能にするため。
 */

import { createHash } from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export type AddressKind =
  | "P2PKH"
  | "P2SH"
  | "P2WPKH"
  | "P2WSH"
  | "P2TR"
  | "UNKNOWN";

export type AddressValidation = {
  valid: boolean;
  kind: AddressKind;
  network: "mainnet" | "testnet" | "unknown";
  reason: string | null;
};

// ---------------------------------------------------------------------------
// Base58Check
// ---------------------------------------------------------------------------

function base58Decode(input: string): Uint8Array | null {
  let num = 0n;
  for (const ch of input) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  // 先頭の '1' は 0x00 バイトを表す
  for (const ch of input) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

function validateBase58Check(address: string): AddressValidation {
  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 25) {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "長さが不正です" };
  }
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      return {
        valid: false,
        kind: "UNKNOWN",
        network: "unknown",
        reason: "チェックサムが一致しません（アドレスの打ち間違いの可能性があります）",
      };
    }
  }

  const version = payload[0];
  // 0x00 = mainnet P2PKH, 0x05 = mainnet P2SH, 0x6f/0xc4 = testnet
  if (version === 0x00) return { valid: true, kind: "P2PKH", network: "mainnet", reason: null };
  if (version === 0x05) return { valid: true, kind: "P2SH", network: "mainnet", reason: null };
  if (version === 0x6f) return { valid: true, kind: "P2PKH", network: "testnet", reason: null };
  if (version === 0xc4) return { valid: true, kind: "P2SH", network: "testnet", reason: null };
  return {
    valid: false,
    kind: "UNKNOWN",
    network: "unknown",
    reason: "対応していないアドレス種別です",
  };
}

// ---------------------------------------------------------------------------
// Bech32 / Bech32m (BIP-173 / BIP-350)
// ---------------------------------------------------------------------------

const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function bech32Verify(hrp: string, data: number[]): "bech32" | "bech32m" | null {
  const chk = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  if (chk === BECH32_CONST) return "bech32";
  if (chk === BECH32M_CONST) return "bech32m";
  return null;
}

/** 5bit 配列 → 8bit 配列（witness program の取り出し） */
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

function validateBech32(address: string): AddressValidation {
  const lower = address.toLowerCase();
  // 大文字と小文字の混在は仕様上禁止（可読性のための規定）
  if (address !== lower && address !== address.toUpperCase()) {
    return {
      valid: false,
      kind: "UNKNOWN",
      network: "unknown",
      reason: "大文字と小文字が混在しています",
    };
  }

  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90) {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "形式が不正です" };
  }

  const hrp = lower.slice(0, pos);
  if (hrp !== "bc" && hrp !== "tb" && hrp !== "bcrt") {
    return {
      valid: false,
      kind: "UNKNOWN",
      network: "unknown",
      reason: "Bitcoin のアドレスではありません",
    };
  }

  const data: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const idx = BECH32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      return {
        valid: false,
        kind: "UNKNOWN",
        network: "unknown",
        reason: "使用できない文字が含まれています",
      };
    }
    data.push(idx);
  }

  const encoding = bech32Verify(hrp, data);
  if (!encoding) {
    return {
      valid: false,
      kind: "UNKNOWN",
      network: "unknown",
      reason: "チェックサムが一致しません（アドレスの打ち間違いの可能性があります）",
    };
  }

  const witnessVersion = data[0];
  const program = convertBits(data.slice(1, -6), 5, 8, false);
  if (!program) {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "データ部が不正です" };
  }

  // v0 は bech32、v1 以降は bech32m でなければならない（BIP-350）
  if (witnessVersion === 0 && encoding !== "bech32") {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "符号化方式が不正です" };
  }
  if (witnessVersion > 0 && encoding !== "bech32m") {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "符号化方式が不正です" };
  }

  const network = hrp === "bc" ? "mainnet" : "testnet";
  if (witnessVersion === 0) {
    if (program.length === 20) return { valid: true, kind: "P2WPKH", network, reason: null };
    if (program.length === 32) return { valid: true, kind: "P2WSH", network, reason: null };
    return { valid: false, kind: "UNKNOWN", network, reason: "プログラム長が不正です" };
  }
  if (witnessVersion === 1 && program.length === 32) {
    return { valid: true, kind: "P2TR", network, reason: null };
  }
  if (program.length < 2 || program.length > 40) {
    return { valid: false, kind: "UNKNOWN", network, reason: "プログラム長が不正です" };
  }
  return { valid: true, kind: "UNKNOWN", network, reason: null };
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

export function validateBitcoinAddress(address: string): AddressValidation {
  const trimmed = address.trim();
  if (!trimmed) {
    return { valid: false, kind: "UNKNOWN", network: "unknown", reason: "入力されていません" };
  }
  if (/^(bc1|tb1|bcrt1)/i.test(trimmed)) return validateBech32(trimmed);
  if (/^[123mn2]/.test(trimmed)) return validateBase58Check(trimmed);
  return {
    valid: false,
    kind: "UNKNOWN",
    network: "unknown",
    reason: "Bitcoin アドレスの形式ではありません",
  };
}

export function isValidBitcoinAddress(address: string): boolean {
  return validateBitcoinAddress(address).valid;
}

/**
 * 本番環境では mainnet 以外への送金を拒否する。
 * testnet アドレスへ本物の BTC を送ると資産が失われるため。
 */
export function assertMainnetAddress(address: string): void {
  const result = validateBitcoinAddress(address);
  if (!result.valid) {
    throw new Error(result.reason ?? "アドレスが不正です");
  }
  if (result.network !== "mainnet") {
    throw new Error(
      "テストネットのアドレスには送金できません（資産が失われる可能性があります）",
    );
  }
}

// ---------------------------------------------------------------------------
// エンコード（デモデータ生成・テスト用）
// ---------------------------------------------------------------------------

export function bech32Encode(hrp: string, witnessVersion: number, program: number[]): string {
  const data = [witnessVersion, ...(convertBits(program, 8, 5, true) ?? [])];
  const constant = witnessVersion === 0 ? BECH32_CONST : BECH32M_CONST;
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ constant;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => BECH32_ALPHABET[d]).join("")}`;
}

/** デモ用の有効な P2WPKH アドレスを決定的に生成する（実在するが誰も鍵を持たない） */
export function demoAddress(seed: string): string {
  const hash = createHash("sha256").update(`btc-cloud-miner:demo:${seed}`).digest();
  return bech32Encode("bc", 0, Array.from(hash.subarray(0, 20)));
}
