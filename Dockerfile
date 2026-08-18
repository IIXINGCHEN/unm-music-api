# 阶段 1: 构建
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm build

# 阶段 2: 生产运行
FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm

ENV NODE_ENV=production
ENV PORT=5678

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 5678
CMD ["node", "dist/index.js"]
