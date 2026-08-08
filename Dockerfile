# BTC CLOUD MINER — 本番用 3 ステージビルド
#
#   docker build -t btc-cloud-miner .
#   docker run -p 3000:3000 --env-file .env.production btc-cloud-miner
#
# next.config.ts の output: "standalone" により、実行に必要な最小限のファイルだけを含む。

# --- Stage 1: 依存のインストール --------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall で prisma generate が走る（スキーマが必要）
RUN npm ci --no-audit --no-fund

# --- Stage 2: ビルド ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Stage 3: 実行 -----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root ユーザーで実行する（コンテナ侵害時の被害を限定する）
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 本番での migrate 実行用に Prisma スキーマを同梱する
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000

# Liveness: プロセス生存のみを確認（依存の状態は /api/health/ready で別途監視する）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
