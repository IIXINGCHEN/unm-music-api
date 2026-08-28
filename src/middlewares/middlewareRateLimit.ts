import type { MiddlewareHandler } from "hono";
import { env, RATE_LIMIT_CONFIG } from "../config/index.js";
import { errorResponse } from "../utils/utilResponse.js";
import type { ApiResponse } from "../types/typeApi.js";

interface IpRecord {
  timestamps: number[];
}

const ipMap = new Map<string, IpRecord>();

// 定期清理过期的 IP 记录，防止内存泄漏 (unref 避免阻塞 Serverless 事件循环)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  for (const [ip, record] of ipMap.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs);
    if (record.timestamps.length === 0) {
      ipMap.delete(ip);
    }
  }
}, RATE_LIMIT_CONFIG.DEFAULT_CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

/**
 * 轻量级滑动窗口 API 速率限制中间件
 */
export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  if (!env.ENABLE_RATE_LIMIT) {
    return await next();
  }

  // 对静态资源或健康检查豁免高频限流
  const path = c.req.path;
  if (
    path === "/health" ||
    path.startsWith("/dashboard") ||
    path.startsWith("/favicon") ||
    path.endsWith(".html") ||
    path.endsWith(".png") ||
    path.endsWith(".css") ||
    path.endsWith(".js")
  ) {
    return await next();
  }

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "127.0.0.1";

  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = env.RATE_LIMIT_MAX_REQUESTS;

  let record = ipMap.get(ip);
  if (!record) {
    // 容量上限保护（与 monitorService.bumpCount 同语义）：追踪表打满后新键不再建条目（放行），
    // 已有键照常限流，防止伪造 XFF 海量新 IP 导致内存慢性膨胀
    if (ipMap.size >= RATE_LIMIT_CONFIG.MAX_IP_KEYS) {
      return await next();
    }
    record = { timestamps: [] };
    ipMap.set(ip, record);
  }

  // 移除窗口外的历史请求
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  const currentCount = record.timestamps.length;
  const remaining = Math.max(0, maxRequests - currentCount - 1);
  const oldestTime = record.timestamps[0] || now;
  const resetSeconds = Math.ceil((oldestTime + windowMs - now) / 1000);

  // 设置标准 RateLimit 响应头
  c.header("RateLimit-Limit", String(maxRequests));
  c.header("RateLimit-Remaining", String(remaining));
  c.header("RateLimit-Reset", String(Math.max(1, resetSeconds)));

  if (currentCount >= maxRequests) {
    c.header("Retry-After", String(Math.max(1, resetSeconds)));
    return c.json<ApiResponse>(
      errorResponse(429, `Too Many Requests: 请求过于频繁，请在 ${Math.max(1, resetSeconds)} 秒后再试`),
      429
    );
  }

  record.timestamps.push(now);
  return await next();
};
