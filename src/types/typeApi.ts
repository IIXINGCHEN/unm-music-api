export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

/**
 * Hono 应用环境类型：跨中间件/路由的上下文变量契约（强类型替代 as any）
 * - matchedSource: /match、/ncmget 等写入命中的音源，监控日志中间件读取
 */
export type AppEnv = {
  Variables: {
    matchedSource?: string;
  };
};

export interface ServerInfoData {
  name: string;
  version: string;
  author: string;
  enable_flac: boolean;
  select_max_br: boolean;
  allowed_domain: string;
  uptime: number;
  providers: string[];
}

export interface HealthData {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  timestamp: string;
  memory?: NodeJS.MemoryUsage;
  cache?: {
    size: number;
    max: number;
    hits: number;
    misses: number;
    hitRate: string;
  };
}
