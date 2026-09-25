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

function firstForwardedIp(c: Context): string | undefined {
  return c.req
    .header("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
}

/**
 * 真实客户端 IP（限流与遥测共用）：
 * - 仅当直连对端是受信代理时，才采信 X-Forwarded-For / X-Real-IP；
 * - 否则一律使用直连对端 IP，防止客户端伪造请求头绕过限流；
 * - 拿不到 socket 的环境（Serverless）退化为旧行为：取请求头，兜底 127.0.0.1。
 */
export function getClientIp(c: Context): string {
  const xffFirst = firstForwardedIp(c);
  const xri = c.req.header("x-real-ip")?.trim();
  const peer = getPeerIp(c);
  if (peer) {
    if (isTrustedProxy(peer)) {
      return xffFirst || xri || peer;
    }
    return peer;
  }
  return xffFirst || xri || "127.0.0.1";
}
