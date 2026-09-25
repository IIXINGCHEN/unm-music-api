import type { MiddlewareHandler } from "hono";
import { getEffectiveMonitorSecret } from "../config/index.js";
import { errorResponse } from "../utils/utilResponse.js";
import { timingSafeCompare } from "../utils/utilSecurity.js";
import type { ApiResponse } from "../types/typeApi.js";

/**
 * 监控大盘与管理接口鉴权中间件
 */
export const monitorAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // 生效密钥：env.MONITOR_SECRET_KEY 为空时由 configEnv 生成 ephemeral 密钥，
  // 因此此处不再存在“未配置即放行”的分支 —— 原实现在密钥为空时直接 next()，
  // 等于把审计日志（调用方 IP、Referer、完整 URL）对公网开放。
  const secretKey = getEffectiveMonitorSecret();
  if (!secretKey) {
    // 理论上不可达（configEnv 已保证非空），fail-closed 兜底
    return c.json<ApiResponse>(
      errorResponse(503, "监控接口鉴权密钥不可用，已拒绝访问"),
      503
    );
  }

  // 1. 请求头 x-api-key
  const headerKey = c.req.header("x-api-key")?.trim();

  // 2. 请求头 Authorization: Bearer <token>
  const authHeader = c.req.header("authorization")?.trim();
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : undefined;

  // 3. Query 参数 ?api_key=xxx
  const queryKey = c.req.query("api_key")?.trim();

  const clientKey = headerKey || bearerKey || queryKey;

  if (clientKey && timingSafeCompare(clientKey, secretKey)) {
    return await next();
  }

  return c.json<ApiResponse>(
    errorResponse(401, "Unauthorized: 监控与管理接口需要正确的 API 访问密钥 (x-api-key)"),
    401
  );
};
