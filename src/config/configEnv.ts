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
// 仅加载项目根目录的 .env（以本模块所在 src/config 目录为基准向上两级；
// 构建产物运行时为 dist/config，向上两级同样是项目根）。
// 不再探测进程 cwd 与其他上级目录：非常规 cwd 启动（如 /tmp）时，
// 攻击者预置的 .env 会被优先加载并劫持 MONITOR_SECRET_KEY 等配置。
// 找不到则跳过（fail-soft），后续 zod 校验与密钥强校验会兜底。
const possibleEnvPaths: string[] = moduleDir
  ? [path.resolve(moduleDir, "..", "..", ".env")]
  : [];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    // 记录实际加载的 .env 来源，便于审计
    console.log(`[Config] 已加载环境变量文件: ${envPath}`);
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
  ALLOWED_DOMAIN: z.string().min(1, "ALLOWED_DOMAIN 不可为空字符串，如需开放请显式设为 *").default(HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN),
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
  // 数值范围校验：TTL 取 1 分钟 ~ 7 天（毫秒），防止误配极大/负值导致缓存语义退化
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
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),
  CACHE_TTL_SEARCH: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_SEARCH_RESULT))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),
  CACHE_TTL_LYRIC: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_LYRIC))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),
  CACHE_TTL_PICTURE: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_PICTURE))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),
  CACHE_TTL_PLAYLIST: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_PLAYLIST))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),
  CACHE_TTL_SONG_DETAIL: z
    .string()
    .optional()
    .default(String(CACHE_POLICY.TTL_SONG_DETAIL))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(60000).max(604800000)),

  // 5. 音频与业务默认行为配置
  // 码率/图片尺寸必须落在上游实际支持的档位内，否则穿透档位回退逻辑
  DEFAULT_BITRATE: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_BITRATE))
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .refine((v) => (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(v), {
          message: `DEFAULT_BITRATE 必须是支持的档位之一: ${AUDIO_CONFIG.SUPPORTED_BITRATES.join(",")}`,
        })
    ),
  DEFAULT_PICTURE_SIZE: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_PICTURE_SIZE))
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .refine((v) => (AUDIO_CONFIG.SUPPORTED_PICTURE_SIZES as readonly number[]).includes(v), {
          message: `DEFAULT_PICTURE_SIZE 必须是支持的尺寸之一: ${AUDIO_CONFIG.SUPPORTED_PICTURE_SIZES.join(",")}`,
        })
    ),
  DEFAULT_SEARCH_COUNT: z
    .string()
    .optional()
    .default(String(AUDIO_CONFIG.DEFAULT_SEARCH_COUNT))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(AUDIO_CONFIG.MAX_SEARCH_COUNT)),
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
  // 仅当直连对端属于受信代理时，才采信 X-Forwarded-For / X-Real-IP 取真实客户端 IP，
  // 否则一律使用直连对端 IP，防止客户端伪造请求头绕过限流。
  TRUSTED_PROXIES: z.string().default("127.0.0.1,::1"),
});

export type Env = z.infer<typeof envSchema>;

/** 第三方平台 Cookie 的 env 键名（@unblockneteasemusic/server 内部读取） */
const PLATFORM_COOKIE_KEYS = ["QQ_COOKIE", "JOOX_COOKIE", "MIGU_COOKIE", "KUWO_COOKIE"] as const;

// 解析得到的 Cookie 值（trim 后），仅供 withPlatformCookies 限时注入使用，不常驻 process.env
const platformCookies: Partial<Record<(typeof PLATFORM_COOKIE_KEYS)[number], string>> = {};

/**
 * 在回调执行期间限时注入第三方平台 Cookie 到 process.env，
 * 供 @unblockneteasemusic/server 内部读取；finally 中删除，
 * 避免 Cookie 常驻进程全局环境、被所有依赖包读取。
 */
export async function withPlatformCookies<T>(fn: () => Promise<T>): Promise<T> {
  for (const [key, value] of Object.entries(platformCookies)) {
    if (value) process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(platformCookies)) {
      delete process.env[key];
    }
  }
}

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量配置验证失败:", result.error.format());
    process.exit(1);
  }

  const parsed = result.data;

  // fail-closed：未配置监控密钥时拒绝启动，而不是静默开放 /api/monitor/*。
  // 该接口返回调用方 IP、Referer 与完整 URL 等审计数据，空密钥默认放行等于对公网开放。
  // 此前曾考虑“生成临时密钥并打印到启动日志”，但日志常被采集、转发与长期归档，
  // 把密钥写进日志等于把它持久化到不受控的介质；且临时密钥每次重启都变，运维难以稳定使用。
  // 改为启动期强校验：运维在 .env 中配置固定密钥后重启。
  if (!parsed.MONITOR_SECRET_KEY?.trim()) {
    console.error(
      "❌ MONITOR_SECRET_KEY 未配置或为空，进程拒绝启动。\n" +
        "   该密钥用于保护 /api/monitor/*（返回调用方 IP、Referer 与完整 URL 等审计数据）。\n" +
        "   请在 .env 中设置 MONITOR_SECRET_KEY='<一段足够长的随机字符串>' 后重启。\n" +
        "   生成示例：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
    process.exit(1);
  }

  // 将 UNM 特性开关同步到 process.env 供 @unblockneteasemusic/server 内部使用。
  // 开关为布尔语义的非敏感配置，保留原有行为。
  if (parsed.ENABLE_FLAC) process.env.ENABLE_FLAC = "true";
  if (parsed.SELECT_MAX_BR) process.env.SELECT_MAX_BR = "true";
  if (parsed.FOLLOW_SOURCE_ORDER) process.env.FOLLOW_SOURCE_ORDER = "true";
  if (parsed.SEARCH_ALBUM) process.env.SEARCH_ALBUM = "true";

  // 第三方平台 Cookie 不再常驻 process.env（原实现在此全局写回，任何依赖包均可读取）。
  // 改为 withPlatformCookies() 的限时注入：仅在调用 UNM 引擎期间写入，
  // finally 中删除，缩小供应链维度的暴露窗口。
  for (const key of PLATFORM_COOKIE_KEYS) {
    const value = parsed[key]?.trim();
    if (value) platformCookies[key] = value;
  }

  return parsed;
}

/**
 * 生效的监控鉴权密钥（trim 后）。
 * configEnv 已保证非空（空密钥时进程拒绝启动），此处仅做防御性取值。
 * 返回值仅供鉴权比较使用，**不得写入日志**。
 */
export function getEffectiveMonitorSecret(): string {
  return env.MONITOR_SECRET_KEY.trim();
}

export const env = parseEnv();
