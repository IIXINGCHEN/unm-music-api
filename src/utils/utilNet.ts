import type { Context } from "hono";
import { env } from "../config/index.js";

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
      } else {
        // fail-loud：静默丢弃会让运维误以为 IPv6 回源段已受信，
        // 实际这些来源走非受信分支、全部请求坍缩到对端 IP 限流桶被集体误限流
        const reason = (addr ?? "").includes(":")
          ? "IPv6 CIDR 暂不支持（仅支持 IPv4 CIDR）"
          : `无法解析为合法的 IPv4 CIDR（addr=${addr ?? ""}, bits=${bitsStr ?? ""}）`;
        console.warn(
          `[TRUSTED_PROXIES] 条目 "${token}" 已丢弃：${reason}。` +
            `影响：来自该网段的请求将走"非受信"分支，不采信 XFF，且按直连对端 IP 限流。`
        );
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

/**
 * 直连对端 IP。Node 服务端经 c.env.incoming.socket 获取；
 * Serverless / 边缘运行时拿不到 socket 时返回 null。
 */
export function getPeerIp(c: Context): string | null {
  try {
    const incoming = (c.env as Record<string, unknown> | undefined)?.incoming as
      | { socket?: { remoteAddress?: unknown } }
      | undefined;
    const addr = incoming?.socket?.remoteAddress;
    if (typeof addr === "string" && addr) return normalizeIp(addr);
  } catch {
    /* 忽略：退化为请求头解析 */
  }
  return null;
}

/**
 * 平台边缘网关注入的客户端 IP 头（按优先级）。
 * 采信前提见 getClientIp：只有"拿不到直连对端（Serverless / 边缘运行时）"
 * 时才采信——此时只有平台能写这些头。直连对端受信（自托管反代）时**不**
 * 再采信：普通反代不会覆盖 cf-connecting-ip 等头，客户端可伪造，
 * 旧逻辑优先采信它们等于把 XFF 伪造从另一扇门 reopen（F-001）。
 */
const EDGE_CLIENT_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "true-client-ip",
  "x-nf-client-connection-ip",
  "x-real-ip",
] as const;

/** 粗略判断是否为合法 IP 字面量（IPv4 或 IPv6），避免把垃圾头值当成客户端 IP */
function isPlausibleIp(ip: string): boolean {
  if (parseIPv4(ip) !== null) return true;
  return ip.includes(":") && /^[0-9a-fA-F:]+$/.test(ip);
}

/** 取平台边缘头中的可信客户端 IP（Serverless / CDN 边缘部署） */
function edgeClientIp(c: Context): string | undefined {
  for (const name of EDGE_CLIENT_IP_HEADERS) {
    const raw = c.req.header(name)?.trim();
    if (!raw) continue;
    // x-vercel-forwarded-for 可能为逗号分隔列表，取首段
    const first = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first && isPlausibleIp(first)) return normalizeIp(first);
  }
  return undefined;
}

/**
 * 从 X-Forwarded-For 链中解析真实客户端 IP。
 * 链 = XFF 各段 + 直连对端，从右向左找第一个**不在** TRUSTED_PROXIES 中的 IP；
 * 若整条链都受信，取最左段（最早的客户端声明）。
 * 背景：Cloudflare 等 CDN 默认是**附加**而非覆盖 XFF，取最左段会被客户端伪造。
 */
function rightmostUntrustedIp(c: Context, peer: string): string {
  const chain = [
    ...(c.req
      .header("x-forwarded-for")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []),
    peer,
  ]
    .map(normalizeIp)
    // F-002：丢弃非 IP 字面量。XFF 链此前没有 isPlausibleIp 守卫，
    // 任意字符串都会原样进入审计日志的 ip 字段（可污染归因与检索）；
    // 丢弃后自然回退到直连对端，不再回显攻击者文本。
    .filter((s) => s.length > 0 && isPlausibleIp(s));
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i];
    if (ip && !isTrustedProxy(ip)) return ip;
  }
  return chain[0] ?? peer;
}

/**
 * 真实客户端 IP（限流与遥测共用）：
 * - 拿不到直连对端（Serverless / 边缘运行时无 socket）：只能采信平台边缘头。
 *   前提是平台会覆盖写入这些头（Vercel / Cloudflare / Netlify 均如此）。
 *   若把 serverless 适配器部署在"不覆盖这些头"的平台上，客户端可伪造身份，
 *   此时应在平台层 strip 相关头，或改用自托管 Node 部署；
 * - 直连对端是受信代理（TRUSTED_PROXIES）：**只走 XFF 链**（最右非受信），
 *   不再优先采信平台边缘头。普通反代（nginx/Caddy 默认配置）不会覆盖
 *   cf-connecting-ip / true-client-ip 等头，客户端自带会被旧逻辑优先采信，
 *   等于限流身份自选（F-001）；XFF 由代理附加写入，伪造段被最右非受信规则排除。
 *   注意：Cloudflare 等 CDN 回源场景请把 CDN 边缘 IP 段加入 TRUSTED_PROXIES，
 *   否则归因坍缩到 CDN 边缘 IP（限流变粗，但不可伪造）；
 * - 对端不受信（直连暴露）：忽略一切请求头，直接用对端 IP；
 * - 拿不到任何来源时返回 "unknown" 而非回环地址：诚实表达缺失归因，
 *   避免把不同客户端坍缩到同一个 127.0.0.1 限流键上。
 */
export function getClientIp(c: Context): string {
  const peer = getPeerIp(c);

  // Serverless / 边缘运行时：无 socket，只能信任平台边缘头
  if (peer === null) {
    return edgeClientIp(c) ?? "unknown";
  }

  // 受信代理：只走 XFF 链，不再采信平台边缘头（F-001）
  if (isTrustedProxy(peer)) {
    return rightmostUntrustedIp(c, peer);
  }

  // 直连暴露：对端不受信，忽略一切客户端可控头
  return peer;
}
