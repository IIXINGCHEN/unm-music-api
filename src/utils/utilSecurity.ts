import crypto from "node:crypto";

/**
 * 安全防御与数据清洗工具库
 */

/**
 * 恒定时间安全字符串比较（基于 SHA-256 哈希散列与 timingSafeEqual，杜绝时序攻击）
 */
export function timingSafeCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) {
    return false;
  }
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * 从白名单条目中提取显式指定的端口。
 * 从原始字符串读取而非 new URL(x).port：WHATWG 会把等于协议默认值的端口归一化掉
 * （"https://x:443" 的 port 为 ""），那会静默解除端口约束，让 http://a.example.com
 * 通过 *.example.com:443 的白名单。
 */
function extractExplicitPort(allowedEntry: string): string {
  // 先剥掉可能的协议前缀，避免把 "https://" 里的 ":" 误判为端口分隔符
  const withoutScheme = allowedEntry.includes("://")
    ? allowedEntry.slice(allowedEntry.indexOf("://") + 3)
    : allowedEntry;
  const hostPart = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const lastColon = hostPart.lastIndexOf(":");
  if (lastColon === -1) return "";
  const port = hostPart.slice(lastColon + 1);
  return /^\d+$/.test(port) ? port : "";
}

/**
 * 校验来源 Origin / Referer 是否在授权白名单内（严格校验协议与 Hostname，杜绝 startsWith 弱匹配漏洞）
 */
export function isAllowedDomain(incoming: string | undefined | null, allowedConfig: string): boolean {
  if (!allowedConfig) {
    // 空配置不再隐含放行：调用方已排除 "*" 的开放语义，
    // 能走到这里的空字符串属于误配置，fail-closed 拒绝，避免白名单被静默绕过
    return false;
  }
  if (allowedConfig.trim() === "*") {
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
  let incomingPort = "";

  try {
    const url = new URL(incoming.includes("://") ? incoming : `https://${incoming}`);
    incomingHost = url.hostname.toLowerCase();
    incomingOrigin = `${url.protocol}//${url.host}`.toLowerCase();
    // 显式端口优先；未显式指定时按协议默认端口归一，
    // 这样 "https://a.example.com" 与白名单 "*.example.com:443" 能正确匹配。
    incomingPort = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
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

      // 端口约束对**所有** host 匹配分支生效：白名单条目显式指定端口时必须精确相等，
      // 否则 "http://localhost:3000" 会放行 ":9999"。该约束原先只加在精确分支上，
      // 泛域名分支（*.example.com:3000）会放行任意端口。
      const rawAllowedPort = extractExplicitPort(allowed);
      const portOk = rawAllowedPort ? incomingPort === rawAllowedPort : true;

      // 2. 泛域名匹配 (例如 *.example.com)
      if (allowedHost.startsWith("*.")) {
        const rootDomain = allowedHost.slice(2);
        if (
          portOk &&
          (incomingHost === rootDomain || incomingHost.endsWith(`.${rootDomain}`))
        ) {
          return true;
        }
      }

      // 3. 精确 Host 匹配
      if (incomingHost === allowedHost && portOk) {
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
  "access_token",
  "refresh_token",
  "id_token",
  "secret",
  "secret_key",
  "client_secret",
  "app_secret",
  "appkey",
  "key",
  "api_key",
  "apikey",
  "api-key",
  "password",
  "passwd",
  "pwd",
  "authorization",
  "auth",
  "cookie",
  "session",
  "jwt",
  "signature",
  "sig",
]);

/**
 * 凭据文本键（用于 pathname 与解析失败场景的兜底脱敏）。
 * 覆盖 "key=value" 形态，分隔符允许 ; & ? / 与字符串边界。
 * 保持精确集合而非子串匹配，避免误伤 keyword 等普通参数。
 */
const CREDENTIAL_TEXT_KEYS = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "secret",
  "secret_key",
  "client_secret",
  "app_secret",
  "api_key",
  "apikey",
  "api-key",
  "password",
  "passwd",
  "authorization",
  "cookie",
] as const;

const SENSITIVE_PATTERN = new RegExp(
  `(^|[;&?/\\s])((?:${CREDENTIAL_TEXT_KEYS.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")}))=([^;&?\\s]*)`,
  "gi"
);

function redactSensitiveText(text: string): string {
  return text.replace(SENSITIVE_PATTERN, (_m, sep: string, key: string) => `${sep}${key}=******`);
}

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
  const isAbsolute = fullUrl.startsWith("http");
  try {
    const url = new URL(isAbsolute ? fullUrl : `http://localhost${fullUrl}`);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "******");
      }
    }
    // new URL() 对 "http://h/;token=SECRET" 这类无 "?" 的输入仍然**解析成功**，
    // 凭据落在 pathname 而非 searchParams，仅遍历 searchParams 会漏掉。
    // 因此对 pathname 再做一次兜底脱敏（catch 分支同样走这里）。
    if (isAbsolute) {
      url.pathname = redactSensitiveText(url.pathname);
      return url.toString();
    }
    return redactSensitiveText(`${url.pathname}${url.search}`);
  } catch {
    // 原实现直接 return fullUrl，把未脱敏的凭据原样写入日志与大盘。
    // 解析失败时改为丢弃 query 并对剩余部分兜底脱敏（绝不原样返回）。
    return redactSensitiveText(fullUrl.split("?")[0] ?? fullUrl);
  }
}
