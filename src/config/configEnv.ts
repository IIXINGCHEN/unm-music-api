import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  HTTP_CONFIG,
  UPSTREAM_APIS,
  CACHE_POLICY,
  PROVIDER_CONFIG,
  AUDIO_CONFIG,
} from "./configConstants.js";
import { getModuleDir } from "../utils/utilPath.js";

const moduleDir = getModuleDir();
const possibleEnvPaths: string[] = [
  path.resolve(process.cwd(), ".env"),
  ...(moduleDir
    ? [
        path.resolve(moduleDir, "..", ".env"),
        path.resolve(moduleDir, "../..", ".env"),
        path.resolve(moduleDir, "../../..", ".env"),
      ]
    : []),
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const envSchema = z.object({
  // 1. 基础服务配置
  HOST: z.string().default(HTTP_CONFIG.DEFAULT_HOST),
  PORT: z
    .string()
    .optional()
    .default(String(HTTP_CONFIG.DEFAULT_PORT))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(65535)),
  ALLOWED_DOMAIN: z
    .string()
    .min(1, "ALLOWED_DOMAIN 不可为空字符串，如需开放请显式设为 *")
    .default(HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // 2. GD Studio 音乐 API 配置
  GDSTUDIO_API_URL: z
    .string()
    .url()
    .default(UPSTREAM_APIS.DEFAULT_GDSTUDIO_URL),

  // 3. 网络与超时配置
  REQUEST_TIMEOUT: z
    .string()
    .optional()
    .default(String(HTTP_CONFIG.DEFAULT_TIMEOUT_MS))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1000).max(60000)),
  PROXY_URL: z.string().default(""),

  // 4. 内存 LRU 缓存策略与 TTL（毫秒）
  CACHE_MAX_SIZE: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.DEFAULT_MAX_ITEMS))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(100).max(50000)),
  CACHE_TTL_AUDIO: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_AUDIO_STREAM))
    .transform((val) => parseInt(val, 10)),
  CACHE_TTL_SEARCH: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_SEARCH_RESULT))
    .transform((val) => parseInt(val, 10)),
  CACHE_TTL_LYRIC: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_LYRIC))
    .transform((val) => parseInt(val, 10)),
  CACHE_TTL_PICTURE: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_PICTURE))
    .transform((val) => parseInt(val, 10)),
  CACHE_TTL_PLAYLIST: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_PLAYLIST))
    .transform((val) => parseInt(val, 10)),
  CACHE_TTL_SONG_DETAIL: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_SONG_DETAIL))
    .transform((val) => parseInt(val, 10)),

  // 5. 音频与业务默认行为配置
  DEFAULT_BITRATE: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_BITRATE))
    .transform((val) => parseInt(val, 10)),
  DEFAULT_PICTURE_SIZE: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_PICTURE_SIZE))
    .transform((val) => parseInt(val, 10)),
  DEFAULT_SEARCH_COUNT: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_SEARCH_COUNT))
    .transform((val) => parseInt(val, 10)),
  DEFAULT_SEARCH_SOURCE: z.string().default(AUDIO_CONFIG.DEFAULT_SEARCH_SOURCE),
  DEFAULT_AUDIO_SOURCE: z.string().default(AUDIO_CONFIG.DEFAULT_AUDIO_SOURCE),
  DEFAULT_TEST_SONG_ID: z.string().default(AUDIO_CONFIG.DEFAULT_TEST_SONG_ID),

  // 6. UNM 音源解灰调度策略
  DEFAULT_MATCH_SERVERS: z
    .string()
    .optional()
    .default(PROVIDER_CONFIG.DEFAULT_PRIORITY_LIST.slice(0, 8).join(",")),
  ENABLE_FLAC: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),
  SELECT_MAX_BR: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),
  FOLLOW_SOURCE_ORDER: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),
  SEARCH_ALBUM: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),

  // 7. 可选第三方平台认证 Cookie
  QQ_COOKIE: z.string().default(""),
  JOOX_COOKIE: z.string().default(""),
  MIGU_COOKIE: z.string().default(""),
  KUWO_COOKIE: z.string().default(""),

  // 8. 安全加固与速率限制配置
  // 监控接口密钥：**必须显式配置且非空**，否则进程拒绝启动（见 parseEnv）。
  // 不使用默认值、不自动生成、不打印到任何日志 —— 日志会被采集与归档，
  // 把密钥写进日志等同于把它持久化到不受控的介质上。
  MONITOR_SECRET_KEY: z.string().default(""),
  ENABLE_RATE_LIMIT: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .optional()
    .default("60000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1000).max(3600000)),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .optional()
    .default("120")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(10000)),
  // 受信反向代理（逗号分隔，支持精确 IP 与 IPv4 CIDR，如 "127.0.0.1,::1,10.0.0.0/8"）。
  // 仅当直连对端属于受信代理时，才采信 X-Forwarded-For / X-Real-IP 取真实客户端 IP；
  // 否则一律使用直连对端 IP，防止客户端伪造请求头绕过限流。
  //
  // 默认**只含回环**。不要把整个私网段（如 172.16.0.0/12）列为默认：
  // Docker bridge 下容器看到的对端是网关 IP（172.17.0.1/172.18.0.1），落在该网段内，
  // 于是网关被判为受信代理、客户端自带的 X-Forwarded-For 被采信 ——
  // 每请求换一个 XFF 就得到一份新的限流配额，正是本机制要防的绕过。
  // 同时该网段内的其它主机也能直连本服务并伪造来源。
  // 反向代理部署请在 .env 中按实际拓扑显式填写（如 "127.0.0.1,10.0.0.0/8"）。
  TRUSTED_PROXIES: z.string().default("127.0.0.1,::1"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 布尔开关写入 process.env。
 *
 * true 写入 "true"；false **删除**变量而不是写 "false" ——
 * 消费方（@unblockneteasemusic/server）用真值判断选择调度模式：
 *   if (process.env.SELECT_MAX_BR)            -> 并发取最高码率
 *   else if (process.env.FOLLOW_SOURCE_ORDER) -> 顺序尝试取首个成功
 *   else                                      -> Promise.any 并发竞速
 * 而 Boolean("false") === true，写入 "false" 会误命中第一个分支。
 * 删除同时清掉运行环境可能预设的旧值，保证 .env 是唯一真源。
 */
function setBoolEnv(key: string, value: boolean): void {
  if (value) {
    process.env[key] = "true";
  } else {
    delete process.env[key];
  }
}

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量配置验证失败:", result.error.format());
    process.exit(1);
  }

  const parsed = result.data;

  // 监控接口密钥必须显式配置：不自动生成、不打印、缺省即拒绝启动。
  // 监控接口会返回调用方 IP、Referer、完整 URL 等审计数据，未受保护时等同公开。
  // 此前实现为“未配置时生成本次进程临时密钥并打印到启动日志”，
  // 但日志常被采集、转发与长期归档，把密钥写进日志等于把它持久化到不受控的介质；
  // 且临时密钥每次重启都变，运维难以稳定使用。改为启动期强校验。
  if (!parsed.MONITOR_SECRET_KEY?.trim()) {
    console.error(
      "❌ MONITOR_SECRET_KEY 未配置或为空，进程拒绝启动。\n" +
        "   该密钥用于保护 /api/monitor/*（返回调用方 IP、Referer 与完整 URL 等审计数据）。\n" +
        "   请在 .env 中设置 MONITOR_SECRET_KEY='<一段足够长的随机字符串>' 后重启。\n" +
        "   生成示例：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
    process.exit(1);
  }

  // 将 UNM 特性开关同步到 process.env 供 @unblockneteasemusic/server 内部使用
  // 安全注意：Cookie 回写后全局可见（process.env），任何依赖包均可读取。
  // 仅在配置了对应 Cookie 时写入；/info 等端点已核验不暴露这些值。
  setBoolEnv("ENABLE_FLAC", parsed.ENABLE_FLAC);
  setBoolEnv("SELECT_MAX_BR", parsed.SELECT_MAX_BR);
  setBoolEnv("FOLLOW_SOURCE_ORDER", parsed.FOLLOW_SOURCE_ORDER);
  setBoolEnv("SEARCH_ALBUM", parsed.SEARCH_ALBUM);
  if (parsed.QQ_COOKIE) process.env.QQ_COOKIE = parsed.QQ_COOKIE;
  if (parsed.JOOX_COOKIE) process.env.JOOX_COOKIE = parsed.JOOX_COOKIE;
  if (parsed.MIGU_COOKIE) process.env.MIGU_COOKIE = parsed.MIGU_COOKIE;
  if (parsed.KUWO_COOKIE) process.env.KUWO_COOKIE = parsed.KUWO_COOKIE;

  return parsed;
}

/**
 * 生效的监控接口密钥。
 *
 * parseEnv 已在启动期强校验其存在且非空，因此这里的值必定有效；
 * 不存在自动生成或回退分支，也不存在“未配置即放行”。
 * 返回值仅供鉴权比较使用，**不得写入日志**。
 */
export function getEffectiveMonitorSecret(): string {
  return env.MONITOR_SECRET_KEY.trim();
}

export const env = parseEnv();
