export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

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
