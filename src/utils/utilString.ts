/**
 * 安全字符串清洗
 */
export function sanitizeParam(val: unknown, maxLen: number = 100, defaultVal: string = ""): string {
  if (val === undefined || val === null) return defaultVal;
  // F-003：剥离换行符——service 层日志直接插值 sanitizeParam 的结果，
  // \r\n 可把一条日志记录劈成多行伪造日志。放在这里让所有调用方默认继承防护；
  // URL 查询参数中换行符永不合法，替换为空格不影响正常取值。
  return String(val).trim().replace(/[\r\n]+/g, " ").slice(0, maxLen);
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
