/**
 * 安全防御与数据清洗工具库
 */

/**
 * 校验来源 Origin / Referer 是否在授权白名单内（严格校验协议与 Hostname，杜绝 startsWith 弱匹配漏洞）
 */
export function isAllowedDomain(incoming: string | undefined | null, allowedConfig: string): boolean {
  if (!allowedConfig || allowedConfig.trim() === "*") {
    return true;
  }
  if (!incoming || typeof incoming !== "string") {
    return false;
  }

  const allowedList = allowedConfig
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowedList.includes("*")) {
    return true;
  }

  let incomingHost = "";
  let incomingOrigin = "";

  try {
    const url = new URL(incoming.includes("://") ? incoming : `https://${incoming}`);
    incomingHost = url.hostname.toLowerCase();
    incomingOrigin = `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return false;
  }

  for (const allowed of allowedList) {
    // 1. 完全相同的 Origin 匹配 (例如 https://music.example.com:3000)
    if (incomingOrigin === allowed || incoming === allowed) {
      return true;
    }

    try {
      const allowedUrl = new URL(allowed.includes("://") ? allowed : `https://${allowed}`);
      const allowedHost = allowedUrl.hostname.toLowerCase();

      // 2. 泛域名匹配 (例如 *.example.com)
      if (allowedHost.startsWith("*.")) {
        const rootDomain = allowedHost.slice(2);
        if (incomingHost === rootDomain || incomingHost.endsWith(`.${rootDomain}`)) {
          return true;
        }
      }

      // 3. 精确 Host 匹配
      if (incomingHost === allowedHost) {
        return true;
      }
    } catch {
      // 容错匹配纯域名格式
      if (incomingHost === allowed) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 敏感字段脱敏清洗（防止 token、password、secret、api_key 泄露至日志或大盘）
 */
export const SENSITIVE_KEYS = new Set([
  "token",
  "secret",
  "key",
  "api_key",
  "apikey",
  "password",
  "passwd",
  "authorization",
  "auth",
  "cookie",
]);

export function sanitizeQuery(query: Record<string, any>): Record<string, any> {
  if (!query || typeof query !== "object") return {};
  const cleaned: Record<string, any> = {};

  for (const [k, v] of Object.entries(query)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      cleaned[k] = "******";
    } else {
      cleaned[k] = v;
    }
  }

  return cleaned;
}

export function sanitizeUrl(fullUrl: string): string {
  if (!fullUrl) return "";
  try {
    const url = new URL(fullUrl.startsWith("http") ? fullUrl : `http://localhost${fullUrl}`);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "******");
      }
    }
    return fullUrl.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
  } catch {
    return fullUrl;
  }
}
