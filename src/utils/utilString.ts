import { env, AUDIO_CONFIG } from "../config/index.js";

/**
 * 安全字符串清洗
 */
export function sanitizeParam(val: unknown, maxLen: number = 100, defaultVal: string = ""): string {
  if (val === undefined || val === null) return defaultVal;
  return String(val).trim().slice(0, maxLen);
}

/**
 * 码率钳制：非支持档位时回退默认值
 */
export function clampBitrate(br: number | string): number {
  return (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(Number(br))
    ? Number(br)
    : env.DEFAULT_BITRATE;
}

/**
 * 音源名归一：清洗、限长、小写，空值回退默认音源
 */
export function normalizeSource(source: unknown, defaultSource: string = env.DEFAULT_SEARCH_SOURCE): string {
  return sanitizeParam(source, 30, defaultSource).toLowerCase();
}

/**
 * 格式化代理播放 URL
 */
export function formatProxyUrl(rawUrl: string, proxyPrefix: string = ""): string {
  if (!rawUrl) return "";
  if (!proxyPrefix) return rawUrl;

  const cleanPrefix = proxyPrefix.endsWith("/") ? proxyPrefix : `${proxyPrefix}/`;
  if (rawUrl.startsWith("http://")) {
    return cleanPrefix + rawUrl.replace(/^http:\/\//, "http/");
  } else if (rawUrl.startsWith("https://")) {
    return cleanPrefix + rawUrl.replace(/^https:\/\//, "https/");
  }
  return rawUrl;
}
