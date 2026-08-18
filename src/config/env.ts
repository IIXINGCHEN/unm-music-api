import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import {
  HTTP_CONFIG,
  UPSTREAM_APIS,
  CACHE_POLICY,
  PROVIDER_CONFIG,
  AUDIO_CONFIG,
} from "./constants.js";

// 确保准确加载 E:\API\ZGiYW3\UNM-Server\.env 文件
// 安全获取模块自身路径：CJS 打包（Netlify Functions）下 import.meta.url 为空，
// 回退使用 __filename / __dirname，两者皆无时跳过相对路径探测
function getModuleDir(): string | null {
  try {
    if (typeof import.meta.url === "string" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    /* import.meta 不可用 */
  }
  const anyMod = globalThis as any;
  if (typeof anyMod.__filename === "string") {
    return path.dirname(anyMod.__filename);
  }
  return null;
}

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
  PORT: z
    .string()
    .optional()
    .default(String(HTTP_CONFIG.DEFAULT_PORT))
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(65535)),
  ALLOWED_DOMAIN: z.string().default(HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN),
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
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量配置验证失败:", result.error.format());
    process.exit(1);
  }

  const parsed = result.data;

  // 将 UNM 特性开关同步到 process.env 供 @unblockneteasemusic/server 内部使用
  if (parsed.ENABLE_FLAC) process.env.ENABLE_FLAC = "true";
  if (parsed.SELECT_MAX_BR) process.env.SELECT_MAX_BR = "true";
  if (parsed.FOLLOW_SOURCE_ORDER) process.env.FOLLOW_SOURCE_ORDER = "true";
  if (parsed.SEARCH_ALBUM) process.env.SEARCH_ALBUM = "true";
  if (parsed.QQ_COOKIE) process.env.QQ_COOKIE = parsed.QQ_COOKIE;
  if (parsed.JOOX_COOKIE) process.env.JOOX_COOKIE = parsed.JOOX_COOKIE;
  if (parsed.MIGU_COOKIE) process.env.MIGU_COOKIE = parsed.MIGU_COOKIE;
  if (parsed.KUWO_COOKIE) process.env.KUWO_COOKIE = parsed.KUWO_COOKIE;

  return parsed;
}

export const env = parseEnv();
