# ==============================================================================
# 阶段 1: 依赖安装与 TypeScript 编译构建
# ==============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml* tsconfig.json tsup.config.ts ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY src ./src
COPY public ./public
RUN pnpm build

# ==============================================================================
# 阶段 2: 生产轻量运行镜像 (支持 linux/amd64 与 linux/arm64 多架构)
# ==============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5678

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5678/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
