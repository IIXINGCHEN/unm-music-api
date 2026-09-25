import crypto from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { env } from "../config/index.js";

/**
 * 安全防御与数据清洗工具库
 */

type TrustedEntry =
  | { kind: "exact"; value: string }
  | { kind: "cidr"; network: number; mask: number };

function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = parseInt(p, 10);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function parseTrustedProxies(raw: string): TrustedEntry[] {
  const entries: TrustedEntry[] = [];
  for (const token of raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    if (token.includes("/")) {
      const [addr, bitsStr] = token.split("/");
      const network = parseIPv4(addr ?? "");
      const bits = parseInt(bitsStr ?? "", 10);
      if (network !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        entries.push({ kind: "cidr", network: (network & mask) >>> 0, mask });
      }
      continue;
    }
    entries.push({ kind: "exact", value: token });
  }
  return entries;
}

// TRUSTED_PROXIES 在进程内不变，解析结果做一次缓存
let cachedRaw = "";
let cachedEntries: TrustedEntry[] = [];

function getTrustedEntries(): TrustedEntry[] {
  const raw = env.TRUSTED_PROXIES ?? "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEntries = parseTrustedProxies(raw);
  }
  return cachedEntries;
}

/** 归一化 IP：小写并剥离 IPv4 映射的 IPv6 前缀（::ffff:1.2.3.4 -> 1.2.3.4） */
export function normalizeIp(ip: string): string {
  const t = ip.trim().toLowerCase();
  return t.startsWith("::ffff:") ? t.slice(7) : t;
}

/** 直连对端是否在 TRUSTED_PROXIES 受信名单内（支持精确 IP 与 IPv4 CIDR） */
export function isTrustedProxy(ip: string): boolean {
  const norm = normalizeIp(ip);
  const num = parseIPv4(norm);
  for (const e of getTrustedEntries()) {
    if (e.kind === "exact") {
      if (e.value === norm) return true;
    } else if (num !== null && ((num & e.mask) >>> 0) === e.network) {
      return true;
    }
  }
  return false;
}

/** 直连对端 IP（经 c.env.incoming.socket 获取；Serverless 下拿不到 socket 时返回 null） */
function getPeerIp(c: Context): string | null {
  try {
    const incoming = (c.env as Record<string, unknown> | undefined)?.incoming as
      | { socket?: { remoteAddress?: unknown } }
      | undefined;
    const addr = incoming?.socket?.remoteAddress;
    if (typeof addr === "string" && addr) return normalizeIp(addr);
  } catch {
    /* 忽略：退化为请求头解析 */
  }
  // 回退到 @hono/node-server 的连接信息（部分适配器不暴露 c.env.incoming）
  try {
    const addr = getConnInfo(c).remote.address;
    if (typeof addr === "string" && addr) return normalizeIp(addr);
  } catch {
    /* 无 socket 信息（Serverless / 边缘运行时） */
  }
  return null;
}

function firstForwardedIp(headerValue: string | undefined): string | undefined {
  return headerValue
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
}

/**
 * 解析客户端真实 IP。
 *
 * 安全模型：**仅当直连对端属于 TRUSTED_PROXIES 时**才采信 X-Forwarded-For /
 * X-Real-IP。这两个头在直连部署下完全由客户端控制，无条件采信等于让每个请求
 * 换一个新 IP 就拿到一份新的限流配额，限流与 topCallers 统计同时失效。
 *
 * Serverless / 边缘运行时拿不到 socket，此时只采信平台注入的不可伪造头
 * （Netlify: x-nf-client-connection-ip；Vercel: x-vercel-forwarded-for）。
 * 注意**不采信 x-real-ip**：它常被当作平台头，但只在 Vercel 边缘会覆写它。
 *
 * 返回 string 以保持既有调用方契约；无法确定时回退 "unknown" ——
 * 该值使限流对这些请求共用一个桶，比塌缩到 127.0.0.1 更诚实（后者会与
 * 真实的本地回环请求混淆），也避免了“无法归因即放行”。
 */
export function getClientIp(c: Context): string {
  const peer = getPeerIp(c);
  if (peer) {
    if (isTrustedProxy(peer)) {
      // 受信代理：XFF 最左端为最初客户端，其次 x-real-ip，再退回对端
      return (
        firstForwardedIp(c.req.header("x-forwarded-for")) ||
        c.req.header("x-real-ip")?.trim() ||
        peer
      );
    }
    // 非受信对端：忽略一切转发头，直接用对端地址
    return peer;
  }

  // Serverless：只采信平台专属头
  const platformIp =
    c.req.header("x-nf-client-connection-ip")?.trim() ||
    firstForwardedIp(c.req.header("x-vercel-forwarded-for"));
  if (platformIp) return normalizeIp(platformIp);

  return "unknown";
}

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
 * 从白名单条目的**原始字符串**中提取显式端口，无则返回 ""。
 *
 * 不能复用 `new URL().port`：URL 规范化会丢弃与协议默认端口相同的显式端口
 * （"https://x:443" → port === ""），导致端口约束对这类条目静默失效 ——
 * 实测 http://a.example.com 会被 *.example.com:443 放行。
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
  // 空配置 fail-closed：调用方（app.ts）已显式排除 "*" 的开放语义，
  // 能走到这里的空字符串属于误配置（如 ALLOWED_DOMAIN=''），
  // 原实现与 "*" 一并返回 true，等于把域名白名单静默绕过。
  if (!allowedConfig) {
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
  "secret",
  "key",
  "api_key",
  "apikey",
  "appkey",
  "access_token",
  "refresh_token",
  "id_token",
  "secret_key",
  "client_secret",
  "app_secret",
  "password",
  "passwd",
  "pwd",
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

/**
 * 自由文本脱敏**专用**的凭据键集。
 *
 * 与 SENSITIVE_KEYS 的区别：后者用于「query 参数名精确匹配」，
 * 宁可过度覆盖（`key`/`auth`/`pwd` 都算敏感）；而本集合用于 pathname、
 * referer、以及 URL 解析失败时的**自由文本**替换 —— 在那里误命中会永久
 * 写坏审计日志里的业务参数值（例如 `?key=` 是某个调用方的正常参数），
 * 属数据丢失而非保护。故这里只保留几乎不可能是业务参数的键。
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

/**
 * 敏感凭据模式（用于 pathname 与解析失败场景的兜底脱敏）。
 * 覆盖 "key=value" 形态，分隔符允许 ; & ? / 与字符串边界。
 */
const SENSITIVE_PATTERN = new RegExp(
  `(^|[;&?/\\s])((?:${CREDENTIAL_TEXT_KEYS.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")}))=([^;&?\\s]*)`,
  "gi"
);

function redactSensitiveText(text: string): string {
  return text.replace(SENSITIVE_PATTERN, (_m, sep: string, key: string) => `${sep}${key}=******`);
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
    // 解析失败时改为丢弃 query 并对剩余部分兜底脱敏。
    return redactSensitiveText(fullUrl.split("?")[0] ?? fullUrl);
  }
}
