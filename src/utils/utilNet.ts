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
 * 采信前提见 getClientIp：只有"拿不到直连对端（Serverless）"或"直连对端受信"
 * 时才采信——边缘网关会覆盖写入这些头；直连暴露部署下对端不受信时，
 * 攻击者可自带 X-Real-IP 等头伪造身份，此时必须忽略。
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
    .filter((s) => s.length > 0);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i];
    if (ip && !isTrustedProxy(ip)) return ip;
  }
  return chain[0] ?? peer;
}

/**
 * 真实客户端 IP（限流与遥测共用）：
 * - 平台边缘头（Vercel / Cloudflare / Netlify 等边缘网关注入）**仅在两种情形采信**：
 *   (1) 拿不到直连对端（Serverless / 边缘运行时无 socket，此时只有平台能写这些头）；
 *   (2) 直连对端是受信代理（TRUSTED_PROXIES）——网关覆盖写入，客户端伪造会被覆盖。
 *   直连暴露部署下对端不受信时一律忽略边缘头：攻击者可自带 X-Real-IP 等头
 *   自选限流身份键，采信即等于把 XFF 伪造从另一扇门 reopen；
 * - 仅当直连对端是受信代理时，才按 XFF 链解析（最右非受信）；
 * - 否则一律使用直连对端 IP，防止客户端伪造请求头绕过限流；
 * - 拿不到任何来源时返回 "unknown" 而非回环地址：诚实表达缺失归因，
 *   避免把不同客户端坍缩到同一个 127.0.0.1 限流键上。
 */
export function getClientIp(c: Context): string {
  const peer = getPeerIp(c);

  // 边缘头采信门：serverless（peer === null）或对端受信才可信
  const edgeTrustworthy = peer === null || isTrustedProxy(peer);
  if (edgeTrustworthy) {
    const edgeIp = edgeClientIp(c);
    if (edgeIp) return edgeIp;
  }

  if (peer) {
    if (isTrustedProxy(peer)) {
      return rightmostUntrustedIp(c, peer);
    }
    return peer;
  }
  return "unknown";
}
