import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/typeApi.js";
import { getEffectiveMonitorSecret } from "../config/index.js";
import { errorResponse } from "../utils/utilResponse.js";
import { timingSafeCompare } from "../utils/utilSecurity.js";
import type { ApiResponse } from "../types/typeApi.js";

/**
 * 监控密钥校验（可复用）：仅支持 x-api-key 头 / Authorization: Bearer。
 * fail-closed：密钥未配置或比对失败一律返回 false。
 * 注意：曾支持 ?api_key= 查询参数，已移除 —— 密钥进入 URL 会留存在浏览器历史、
 * 书签、反向代理/CDN 访问日志中，并可能经 Referer 外泄。
 */
export function isMonitorAuthorized(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): boolean {
  const secretKey = getEffectiveMonitorSecret();
  if (!secretKey) return false;

  const headerKey = c.req.header("x-api-key")?.trim();

  const authHeader = c.req.header("authorization")?.trim();
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : undefined;

  const clientKey = headerKey || bearerKey;
  return !!clientKey && timingSafeCompare(clientKey, secretKey);
}

/**
 * 监控大盘与管理接口鉴权中间件（fail-closed）
 */
export const monitorAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // 生效密钥：configEnv 已在启动期强校验非空（空密钥时进程拒绝启动），
  // 因此此处不再存在“未配置即放行”的分支 —— 原实现在密钥为空时直接 next()，
  // 等于把审计日志（调用方 IP、Referer、完整 URL）对公网开放。
  if (isMonitorAuthorized(c)) {
    return await next();
  }

  const secretKey = getEffectiveMonitorSecret();
  if (!secretKey) {
    // 理论上不可达（configEnv 已保证非空），fail-closed 兜底
    return c.json<ApiResponse>(
      errorResponse(503, "监控接口鉴权密钥不可用，已拒绝访问"),
      503
    );
  }

  return c.json<ApiResponse>(
    errorResponse(401, "Unauthorized: 监控与管理接口需要正确的 API 访问密钥 (x-api-key)"),
    401
  );
};
