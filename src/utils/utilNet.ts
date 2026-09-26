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

// ---- Cloudflare 边缘 IP 自动更新（CF_AUTO_TRUSTED_IPS） ----
// 进程首次解析受信表时触发：立即拉取一次，之后按 CF_TRUSTED_IPS_INTERVAL_MS
// 定时刷新。结果只做内存合并（不写 .env），拉取/校验失败时沿用上次有效列表。
let cfRefreshStarted = false;
let cfCidrs = ""; // 上次成功下发的 CIDR（逗号分隔），合并进受信表
let cfGeneration = 0; // 成功刷新次数，计入受信表缓存键

/**
 * 校验 Cloudflare 下发的 IP 段文本：合法时返回 IPv4 CIDR 数组，
 * 否则返回 null（调用方保留旧表，永不接受可疑列表）。
 * 校验规则：非空、条数上限 128、逐行严格 IPv4 CIDR、拒绝 /8 更粗网段
 * （防投毒：Cloudflare 官方当前最粗为 /13）。
 */
export function parseCloudflareIpList(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 128) return null;
  const out: string[] = [];
  for (const line of lines) {
    const m = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3})\/([0-9]{1,2})$/.exec(line);
    const ipPart = m?.[1];
    const bitsPart = m?.[2];
    if (!m || !ipPart || !bitsPart) return null;
    if (parseIPv4(ipPart) === null) return null;
    const bits = parseInt(bitsPart, 10);
    if (!Number.isInteger(bits) || bits < 8 || bits > 32) return null;
    out.push(`${ipPart}/${bits}`);
  }
  return out;
}

async function refreshCloudflareRanges(): Promise<void> {
  const url = env.CF_TRUSTED_IPS_URL ?? "";
  try {
    // 只允许 HTTPS：明文拉取可被中间人投毒，等于直接改写受信表
    if (!url.startsWith("https://")) {
      throw new Error("CF_TRUSTED_IPS_URL 必须为 https:// 前缀");
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseCloudflareIpList(await res.text());
    if (!list) throw new Error("下发列表校验未通过（空/格式非法/含超粗网段）");
    cfCidrs = list.join(",");
    cfGeneration++;
    console.log(
      `[TRUSTED_PROXIES] Cloudflare 边缘 IP 段已刷新：${list.length} 条 IPv4 CIDR（第 ${cfGeneration} 次）`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[TRUSTED_PROXIES] Cloudflare 边缘 IP 段刷新失败，沿用旧表：${msg}`);
  }
}

function ensureCfRefreshStarted(): void {
  if (cfRefreshStarted || !env.CF_AUTO_TRUSTED_IPS) return;
  cfRefreshStarted = true;
  // 启动时立即拉一次，之后定时刷新；unref 避免阻塞 Serverless 事件循环
  void refreshCloudflareRanges();
  const timer = setInterval(() => {
    void refreshCloudflareRanges();
  }, env.CF_TRUSTED_IPS_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function getTrustedEntries(): TrustedEntry[] {
  ensureCfRefreshStarted();
  const raw = `${env.TRUSTED_PROXIES ?? ""},${cfCidrs}`;
  // 缓存键带上 CF 刷新代际：列表更新后旧缓存即失效
  const key = `${cfGeneration}#${raw}`;
  if (key !== cachedRaw) {
    cachedRaw = key;
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
