import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/typeApi.js";
import { env, RATE_LIMIT_CONFIG } from "../config/index.js";
import { errorResponse } from "../utils/utilResponse.js";
import { getClientIp } from "../utils/utilNet.js";
import type { ApiResponse } from "../types/typeApi.js";

interface IpRecord {
  timestamps: number[];
}

const ipMap = new Map<string, IpRecord>();

/**
 * F-006：限流表键数上限（近似 LRU）。此前无界——结合身份伪造可制造无限键，
 * 常驻至清理周期。与 serviceMonitor 的 stat 上限同类防护。
 */
export const RATE_LIMIT_MAX_KEYS = 5000;

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
export const rateLimitMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!env.ENABLE_RATE_LIMIT) {
    return await next();
  }

  // 对静态资源或健康检查豁免高频限流
  // 仅豁免真实存在的静态资源前缀与健康检查：后缀匹配可被 "/match.html" 类伪造路径绕过
  const path = c.req.path;
  const STATIC_EXEMPT_PREFIXES = ["/assets/", "/vendor/", "/favicon", "/dashboard", "/monitor"];
  if (
    path === "/health" ||
    path === "/ping" ||
    STATIC_EXEMPT_PREFIXES.some((p) => path.startsWith(p))
  ) {
    return await next();
  }

  // 仅受信代理才采信 X-Forwarded-For，防止客户端伪造 IP 绕过限流
  const ip = getClientIp(c);

  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = env.RATE_LIMIT_MAX_REQUESTS;

  let record = ipMap.get(ip);
  if (record) {
    // 命中键刷新为最新，保持近似 LRU 语义：热点键不被冷键挤出
    ipMap.delete(ip);
    ipMap.set(ip, record);
  } else {
    // 新键：超上限时淘汰最久未访问键（Map 保持插入顺序，首键即最老）
    if (ipMap.size >= RATE_LIMIT_MAX_KEYS) {
      const oldest = ipMap.keys().next();
      if (!oldest.done) ipMap.delete(oldest.value);
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
