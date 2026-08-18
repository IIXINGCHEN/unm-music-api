import type { MiddlewareHandler } from "hono";
import { env } from "../config/index.js";
import { errorResponse } from "../utils/response.js";
import type { ApiResponse } from "../types/api.js";

/**
 * 监控大盘与管理接口鉴权中间件
 */
export const monitorAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const secretKey = env.MONITOR_SECRET_KEY?.trim();
  // 若未设置密钥，则默认开放访问
  if (!secretKey) {
    return await next();
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

  if (clientKey === secretKey) {
    return await next();
  }

  return c.json<ApiResponse>(
    errorResponse(401, "Unauthorized: 监控与管理接口需要正确的 API 访问密钥 (x-api-key)"),
    401
  );
};
