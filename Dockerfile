# ==============================================================================
# 阶段 1: 依赖安装与 TypeScript 编译构建
# ==============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

# pnpm 钉死精确版本（10.34.5），避免浮动整个 10.x 引入不可复现的构建
RUN npm install -g pnpm@10.34.5

COPY package.json pnpm-lock.yaml* tsconfig.json tsup.config.ts tailwind.config.cjs VERSION ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN pnpm build
# 生产镜像不携带 sourcemap（dist/*.js.map 含完整 TS 源码，150KB+）：构建产物清理，
# 只影响镜像；本地 pnpm build 仍保留 map 便于调试
RUN rm -f dist/*.js.map

# ==============================================================================
# 阶段 2: 生产轻量运行镜像 (支持 linux/amd64 与 linux/arm64 多架构)
# ==============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5678

# pnpm 钉死精确版本（与 builder 阶段一致）
RUN npm install -g pnpm@10.34.5

COPY package.json pnpm-lock.yaml* VERSION* ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5678/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
