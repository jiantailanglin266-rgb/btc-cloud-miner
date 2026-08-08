import Link from "next/link";

export const metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" className="text-xs text-accent hover:underline">
        ← トップへ戻る
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">利用規約（ひな型）</h1>
      <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-warn">
        これは納品用のひな型です。実際のサービス提供前に、必ず暗号資産分野に精通した弁護士のレビューを受け、
        事業内容・提供国に合わせて確定させてください（docs/法規制・コンプライアンス.md 参照）。
      </div>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第1条（本サービス）</h2>
          <p>
            本サービスは、運営者が契約する外部マイニング設備のハッシュレートの利用および
            その稼働状況・収益の管理機能を提供する役務です。投資商品・預り金・集団投資スキームではありません。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第2条（収益の非保証）</h2>
          <p>
            表示される収益はすべて推定値であり、運営者はいかなる収益も保証しません。
            ネットワーク難易度・BTC 価格・設備稼働率等により、損失が発生する可能性があります。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第3条（本人確認）</h2>
          <p>
            出金には本人確認（KYC)の完了が必要です。虚偽の情報による登録が判明した場合、
            アカウントを停止することがあります。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第4条（禁止事項）</h2>
          <p>
            マネーロンダリング等の犯罪への利用、不正アクセス、システムへの過度な負荷、
            第三者へのアカウント譲渡を禁止します。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第5条（サービスの停止・変更）</h2>
          <p>
            外部設備・外部 API の障害、法令の変更等により、事前の通知なくサービスの全部または一部を
            停止・変更することがあります。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">第6条（免責）</h2>
          <p>
            運営者は、故意または重過失による場合を除き、本サービスの利用により生じた損害について
            責任を負いません。
          </p>
        </section>
      </div>
    </main>
  );
}
