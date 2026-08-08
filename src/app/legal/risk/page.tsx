import Link from "next/link";

export const metadata = { title: "リスク開示" };

export default function RiskPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" className="text-xs text-accent hover:underline">
        ← トップへ戻る
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">リスク開示書</h1>
      <p className="mt-2 text-xs text-ink-dim">
        本書は、本サービスのご利用にあたって必ずご理解いただきたいリスクを説明するものです。
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-medium text-ink">1. 本サービスの性質</h2>
          <p>
            本サービスは、外部のマイニング設備（ASIC）が行う Bitcoin
            採掘に関する<strong className="text-ink">ハッシュレートの利用と運用管理の役務</strong>を提供するものであり、
            預金・投資商品・集団投資スキームではありません。元本の保証、収益の保証は一切ありません。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-ink">2. 収益がマイナスになる可能性</h2>
          <p>画面に表示される収益はすべて推定値であり、以下の要因で大きく変動します。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">BTC 価格の下落</strong> —
              採掘した BTC の法定通貨価値が下がると、電力コストを下回り赤字になる可能性があります。
            </li>
            <li>
              <strong className="text-ink">ネットワーク難易度の上昇</strong> —
              難易度は長期的に上昇傾向にあり、同じハッシュレートで採掘できる BTC は減少し続けます。
            </li>
            <li>
              <strong className="text-ink">半減期</strong> — 約4年ごとにブロック報酬が半分になります。
              半減期をまたぐ契約では、後半の採掘量が大きく減少します。
            </li>
            <li>
              <strong className="text-ink">設備の停止・故障</strong> —
              停電・故障・メンテナンスにより採掘が停止する期間があります。
            </li>
            <li>
              <strong className="text-ink">電力価格の変動</strong> —
              契約条件によっては電力コストの上昇が収益を圧迫します。
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-ink">3. 事業者リスク</h2>
          <p>
            マイニング設備の提供事業者、マイニングプール、カストディ事業者の破綻・障害・契約打ち切りにより、
            サービスの全部または一部が停止する可能性があります。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-ink">4. 暗号資産固有のリスク</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Bitcoin の送金は取り消せません。誤ったアドレスへの送金は回復できません。</li>
            <li>秘密鍵・アカウントの管理不備により資産を失う可能性があります。</li>
            <li>法令・税制の変更により、サービス内容の変更・停止があり得ます。</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-ink">5. 技術的な事実</h2>
          <p>
            Bitcoin の採掘には実際の SHA-256 ハッシュ計算が必要です。
            計算資源なしで BTC が生成される仕組みは存在しません。
            「必ず儲かる」「リスクなし」等をうたう類似サービスにはご注意ください。
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-ink">6. ご契約前に</h2>
          <p>
            シミュレーターで<strong className="text-ink">感度分析（価格 -50%・難易度 +30% のケース）</strong>
            を必ずご確認のうえ、余裕資金の範囲でご利用ください。
            税務上の取り扱いは税理士等の専門家にご確認ください。
          </p>
        </section>
      </div>
    </main>
  );
}
