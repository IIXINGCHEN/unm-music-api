/**
 * 安全字符串清洗
 */
export function sanitizeParam(val: unknown, maxLen: number = 100, defaultVal: string = ""): string {
  if (val === undefined || val === null) return defaultVal;
  return String(val).trim().slice(0, maxLen);
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
