/**
 * 安全字符串清洗
 */
export function sanitizeParam(val: unknown, maxLen: number = 100, defaultVal: string = ""): string {
  if (val === undefined || val === null) return defaultVal;
  return String(val).trim().slice(0, maxLen);
}

/**
 * 日志参数清洗：用户输入直接拼入 console 日志时，换行符可伪造日志行
 * （如伪造 [GDStudio] 错误行污染审计）。打日志前先过一遍此函数。
 */
export function sanitizeLogParam(val: unknown): string {
  return String(val ?? "").replace(/[\r\n]/g, " ");
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
