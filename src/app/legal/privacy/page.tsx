import Link from "next/link";

export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" className="text-xs text-accent hover:underline">
        ← トップへ戻る
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">プライバシーポリシー（ひな型）</h1>
      <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-warn">
        これは納品用のひな型です。実際のサービス提供前に、取得する情報・委託先・保存期間を確定させ、
        専門家のレビューを受けてください。
      </div>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">1. 取得する情報</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>アカウント情報（氏名・メールアドレス・パスワードのハッシュ）</li>
            <li>本人確認情報（KYC ステータス。書類そのものは外部の認証事業者が保管します）</li>
            <li>取引情報（契約・採掘報酬・出金の記録）</li>
            <li>技術情報（IP アドレス・ブラウザ情報・ログイン履歴）</li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">2. 利用目的</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>本サービスの提供・本人確認・不正利用の防止</li>
            <li>法令に基づく記録の保存（取引記録は7年間保存します）</li>
            <li>サポート対応・重要なお知らせの送付</li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">3. 第三者提供・委託</h2>
          <p>
            本人確認事業者・カストディ事業者・インフラ事業者へ、業務に必要な範囲で委託します。
            法令に基づく場合を除き、同意なく第三者へ提供しません。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">4. 安全管理</h2>
          <p>
            通信の暗号化（TLS）、保存データの暗号化、アクセス制御、監査ログにより保護します。
            パスワードは復元不可能なハッシュとして保存されます。
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">5. 開示・訂正・削除</h2>
          <p>
            ご本人からの請求により、保有する情報の開示・訂正・削除に対応します。
            ただし法令で保存が義務付けられた記録は、期間満了まで削除できません。
          </p>
        </section>
      </div>
    </main>
  );
}
