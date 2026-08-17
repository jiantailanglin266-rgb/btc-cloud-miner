"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { apiFetch, ApiError } from "@/lib/client";
import { Badge, Button, Card, CardTitle, ErrorState } from "@/components/ui";

type SetupResult = { secret: string; otpauthUri: string };

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // otpauth URI をブラウザ内で QR 画像化する（外部サービスへ秘密を送らない）
  useEffect(() => {
    if (!setup) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null)); // QR 生成失敗時は手動キー入力にフォールバック
  }, [setup]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle
        hint="出金・アドレス登録などの重要操作には2段階認証が必須です"
        action={
          <Badge tone={enabled ? "online" : "offline"} dot>
            {enabled ? "有効" : "未設定"}
          </Badge>
        }
      >
        2段階認証（TOTP）
      </CardTitle>

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {recoveryCodes && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 p-3">
          <p className="text-xs font-medium text-warn">
            リカバリーコード（この画面でしか表示されません）
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            認証アプリを使えなくなった場合に必要です。安全な場所に保管してください。
            各コードは1回しか使えません。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {recoveryCodes.map((c) => (
              <code key={c} className="rounded bg-black/30 px-2 py-1">
                {c}
              </code>
            ))}
          </div>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setRecoveryCodes(null);
              router.refresh();
            }}
          >
            保管しました
          </Button>
        </div>
      )}

      {!enabled && !setup && !recoveryCodes && (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            Google Authenticator・Authy などの認証アプリを使って、ログインと重要操作を保護します。
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await apiFetch<SetupResult>("/api/auth/2fa", {
                  json: { action: "setup" },
                });
                setSetup(result);
              })
            }
          >
            2段階認証を設定する
          </Button>
        </>
      )}

      {setup && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-ink-muted">
              1. 認証アプリで QR コードを読み取ってください（またはキーを手動で追加）。
            </p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- ローカル生成の data URL のため next/image は不要
              <img
                src={qrDataUrl}
                alt="2段階認証セットアップ用 QR コード"
                width={192}
                height={192}
                className="mt-2 rounded-lg border border-white/10 bg-white p-2"
              />
            )}
            <code className="mt-1.5 block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-brand">
              {setup.secret}
            </code>
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-ink-dim">
                otpauth URI を表示
              </summary>
              <code className="mt-1 block break-all text-[10px] text-ink-dim">
                {setup.otpauthUri}
              </code>
            </details>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-ink-muted">
              2. 表示された6桁のコードを入力してください
            </label>
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em]"
            />
          </div>

          <div className="flex gap-2">
            <Button
              disabled={busy || code.length !== 6}
              onClick={() =>
                run(async () => {
                  const result = await apiFetch<{ recoveryCodes: string[] }>(
                    "/api/auth/2fa",
                    { json: { action: "enable", code } },
                  );
                  setRecoveryCodes(result.recoveryCodes);
                  setSetup(null);
                  setCode("");
                })
              }
            >
              有効にする
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSetup(null);
                setCode("");
              }}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {enabled && !recoveryCodes && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            2段階認証は有効です。無効にすると出金ができなくなります。
          </p>
          <div>
            <label className="mb-1.5 block text-xs text-ink-muted">
              無効にするには現在のコードを入力してください
            </label>
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center tracking-[0.3em]"
            />
          </div>
          <Button
            variant="danger"
            disabled={busy || code.length !== 6}
            onClick={() =>
              run(async () => {
                await apiFetch("/api/auth/2fa", { json: { action: "disable", code } });
                setCode("");
                router.refresh();
              })
            }
          >
            2段階認証を無効にする
          </Button>
        </div>
      )}
    </Card>
  );
}
