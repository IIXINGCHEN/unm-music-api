import type { MiddlewareHandler } from "hono";
import { env, RATE_LIMIT_CONFIG } from "../config/index.js";
import { errorResponse } from "../utils/utilResponse.js";
import { getClientIp } from "../utils/utilSecurity.js";
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

  // 对静态资源或健康检查豁免高频限流。
  //
  // 必须用**前缀**匹配，不能按后缀（原实现含 path.endsWith(".html"/".css"/".js")）。
  // 后缀匹配下任意请求都能自我豁免：/match.html?id=191060 不匹配任何真实路由，
  // 却因以 .html 结尾而绕过限流，攻击者据此可无限次触发上游级联（响应是 404，
  // 但上游调用已经发生）。静态资源实际只位于 /assets/ 与 /vendor/ 下。
  //
  // /dashboard 与 /monitor 是动态 HTML 路由（每次渲染触发磁盘 I/O 与内联 CSS 拼接），
  // 不是静态资源，纳入限流保护。
  const path = c.req.path;
  const STATIC_EXEMPT_PREFIXES = ["/assets/", "/vendor/", "/favicon"];
  if (
    path === "/health" ||
    path === "/ping" ||
    STATIC_EXEMPT_PREFIXES.some((p) => path.startsWith(p))
  ) {
    return await next();
  }

  // 仅受信代理才采信 XFF / x-real-ip，防止客户端伪造 IP 绕过限流。
  // 无法归因的请求（Serverless 且无平台头）统一记为 "unknown" 并共用一个限流桶，
  // 既不塌缩到 127.0.0.1 与真实回环请求混淆，也不因无法归因就放行。
  const ip = getClientIp(c);

  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = env.RATE_LIMIT_MAX_REQUESTS;

  let record = ipMap.get(ip);
  if (!record) {
    // 容量上限保护：追踪表打满时**淘汰最旧的键**腾出空间，而不是放行新键。
    //
    // 原实现选择放行（return next()），理由是防止伪造 IP 导致内存膨胀。
    // 但这使容量打满后全站限流失效：攻击者只需制造 MAX_IP_KEYS 个不同键
    // （受信代理部署下用单个连接伪造 XFF 即可，无需真实 IP 资源），
    // 此后所有客户端都不再受限流保护 —— 防内存膨胀的代价是关掉了防护本身。
    //
    // Map 的迭代顺序即插入顺序，首个键是最久未新建的。淘汰它只让该键的
    // 计数从零重新累积（等价于窗口重置），内存上界不变，而限流对每个请求
    // 仍然生效。选择淘汰最旧而非最不活跃，是为了不引入额外的访问时间戳维护成本。
    if (ipMap.size >= RATE_LIMIT_CONFIG.MAX_IP_KEYS) {
      const oldestKey = ipMap.keys().next().value;
      if (oldestKey !== undefined) {
        ipMap.delete(oldestKey);
      }
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
