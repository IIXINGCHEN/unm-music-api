/**
 * 系统统一常量定义中心
 * 集中管理所有默认值、缓存策略、音源优先级与上游接口地址，杜绝代码中的任何魔法数字与硬编码字符串
 */

import { APP_VERSION } from "./configVersion.js";

export const APP_INFO = {
  NAME: "unm-server",
  VERSION: APP_VERSION,
  AUTHOR: "imsyy",
  DESCRIPTION: "网易云解灰与跨平台音乐 API 服务 (Hono + TypeScript Modern Edition)",
  LICENSE: "MIT",
} as const;

export const AUDIO_CONFIG = {
  DEFAULT_BITRATE: 320,
  SUPPORTED_BITRATES: [128, 192, 320, 740, 999] as const,
  DEFAULT_PICTURE_SIZE: 300,
  SUPPORTED_PICTURE_SIZES: [300, 500] as const,
  DEFAULT_SEARCH_COUNT: 20,
  MAX_SEARCH_COUNT: 100,
  DEFAULT_SEARCH_PAGE: 1,
  DEFAULT_SEARCH_SOURCE: "netease",
  DEFAULT_AUDIO_SOURCE: "joox",
  DEFAULT_TEST_SONG_ID: "1962165898", // 周杰伦 - 最伟大的作品
} as const;

export const CACHE_POLICY = {
  DEFAULT_MAX_ITEMS: 2000,
  TTL_AUDIO_STREAM: 2 * 3600 * 1000, // 2 小时
  TTL_SEARCH_RESULT: 30 * 60 * 1000, // 30 分钟
  TTL_LYRIC: 12 * 3600 * 1000, // 12 小时
  TTL_PICTURE: 24 * 3600 * 1000, // 24 小时
  TTL_PLAYLIST: 2 * 3600 * 1000, // 2 小时
  TTL_SONG_DETAIL: 24 * 3600 * 1000, // 24 小时
} as const;

export const UPSTREAM_APIS = {
  DEFAULT_GDSTUDIO_URL: "https://music-api.gdstudio.xyz/api.php",
  NETEASE_SONG_DETAIL: "https://music.163.com/api/song/detail",
  NETEASE_SONG_DETAIL_V3: "https://music.163.com/api/v3/song/detail",
  NETEASE_PLAYLIST_DETAIL: "https://music.163.com/api/v6/playlist/detail",
  NETEASE_REFERER: "https://music.163.com/",
} as const;

export const PROVIDER_CONFIG = {
  DEFAULT_PRIORITY_LIST: [
    "gdstudio",
    "pyncmd",
    "bodian",
    "joox",
    "kugou",
    "kuwo",
    "bilivideo",
    "bilibili",
    "ytdlp",
    "migu",
    "qq",
    "youtubedl",
    "youtube",
  ] as const,
  PRIMARY_DECRYPT_PROVIDERS: ["gdstudio", "pyncmd", "bodian", "joox"] as const,
} as const;

export const HTTP_CONFIG = {
  DEFAULT_HOST: "127.0.0.1",
  DEFAULT_PORT: 5678,
  DEFAULT_TIMEOUT_MS: 10000,
  DEFAULT_ALLOWED_ORIGIN: "*",
  USER_AGENT: `UNM-Server/${APP_VERSION} (TypeScript; Hono Edition)`,
  BROWSER_USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
} as const;

export const MONITOR_CONFIG = {
  DEFAULT_MAX_LOGS: 1000,
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MAX_PAGE_LIMIT: 200, // /monitor/data 单页 limit 上限
  DEFAULT_MAX_STAT_KEYS: 500,
} as const;

export const RATE_LIMIT_CONFIG = {
  DEFAULT_CLEANUP_INTERVAL_MS: 120000, // 2 分钟清理周期
  MAX_IP_KEYS: 10000, // IP 追踪表容量上限：防止伪造 XFF 海量新键导致内存慢性膨胀
} as const;

export const PLAYLIST_CONFIG = {
  MAX_LIMIT: 5000, // /playlist 单次最大返回曲目数上限，杜绝无界并发上游请求
  DETAIL_CHUNK_SIZE: 200, // 网易云批量详情接口单批曲目数
  DETAIL_CHUNK_CONCURRENCY: 5, // 详情批量拉取的并发 chunk 数上限
} as const;
