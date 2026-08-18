import { Hono } from "hono";
import { env, APP_INFO } from "../config/index.js";
import { globalCache } from "../services/cache.js";
import { getAvailableProviders } from "../services/unm.js";
import { successResponse } from "../utils/response.js";
import type { ApiResponse, ServerInfoData, HealthData } from "../types/api.js";

const infoRoute = new Hono();
const startTime = Date.now();

// 获取服务器基本信息
infoRoute.get("/info", (c) => {
  const data: ServerInfoData = {
    name: APP_INFO.NAME,
    version: APP_INFO.VERSION,
    author: APP_INFO.AUTHOR,
    enable_flac: env.ENABLE_FLAC,
    select_max_br: env.SELECT_MAX_BR,
    allowed_domain: env.ALLOWED_DOMAIN,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    providers: getAvailableProviders(),
  };

  return c.json<ApiResponse<ServerInfoData>>(successResponse(data));
});

// 健康状态与指标检查
infoRoute.get("/health", (c) => {
  const verbose = c.req.query("verbose") === "true" || c.req.query("verbose") === "1";
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const data: HealthData = {
    status: "healthy",
    uptime,
    timestamp: new Date().toISOString(),
  };

  if (verbose) {
    data.memory = process.memoryUsage();
    data.cache = globalCache.stats();
  }

  return c.json<ApiResponse<HealthData>>(successResponse(data, "OK"));
});

// 快速 Ping 存活检查
infoRoute.get("/ping", (c) => {
  return c.json({ code: 200, message: "pong" });
});

export { infoRoute };
