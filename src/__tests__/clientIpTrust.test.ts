import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isTrustedProxy, normalizeIp, getClientIp } from "../utils/utilSecurity.js";

/**
 * 回归：客户端 IP 解析必须只在直连对端属于受信代理时才采信转发头。
 *
 * 历史缺陷：getClientIp 无条件采信 x-forwarded-for 首段与 x-real-ip。
 * 这两个头在直连部署下完全由客户端控制，每个请求换一个新值即可拿到一份新的
 * 限流配额，限流与 topCallers 归因同时失效。
 */
describe("getClientIp 受信代理链", () => {
  /** 构造带/不带 socket 的上下文 */
  const ctx = (peer: string | null, headers: Record<string, string> = {}) => ({
    env: peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
    req: { header: (k: string) => headers[k.toLowerCase()] ?? null },
  });

  test("normalizeIp 剥离 IPv4 映射前缀", () => {
    assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
    assert.equal(normalizeIp("  203.0.113.9  "), "203.0.113.9");
  });

  test("受信名单：精确 IP 与 CIDR", () => {
    assert.equal(isTrustedProxy("127.0.0.1"), true);
    assert.equal(isTrustedProxy("::ffff:127.0.0.1"), true);
    assert.equal(isTrustedProxy("172.18.0.1"), true, "Docker bridge 网关应受信");
    assert.equal(isTrustedProxy("203.0.113.9"), false, "公网 IP 不受信");
  });

  test("直连公网时忽略伪造的 XFF 与 x-real-ip", () => {
    const ip = getClientIp(
      ctx("203.0.113.9", {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      }) as any
    );
    assert.equal(ip, "203.0.113.9", "必须使用直连对端，而非伪造头");
  });

  test("受信代理时采信 XFF 最左端", () => {
    const ip = getClientIp(
      ctx("127.0.0.1", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }) as any
    );
    assert.equal(ip, "198.51.100.7");
  });

  test("受信代理无 XFF 时退回 x-real-ip，再退回对端", () => {
    assert.equal(getClientIp(ctx("127.0.0.1", { "x-real-ip": "198.51.100.8" }) as any), "198.51.100.8");
    assert.equal(getClientIp(ctx("127.0.0.1") as any), "127.0.0.1");
  });

  test("Serverless 只采信平台专属头，不采信 x-real-ip", () => {
    assert.equal(
      getClientIp(ctx(null, { "x-nf-client-connection-ip": "198.51.100.9" }) as any),
      "198.51.100.9"
    );
    assert.equal(
      getClientIp(ctx(null, { "x-vercel-forwarded-for": "198.51.100.10, 10.0.0.1" }) as any),
      "198.51.100.10"
    );
    // x-real-ip 只在 Vercel 边缘会被覆写，不能作为平台头采信
    assert.equal(getClientIp(ctx(null, { "x-real-ip": "1.2.3.4" }) as any), "unknown");
    assert.equal(getClientIp(ctx(null, { "x-forwarded-for": "1.2.3.4" }) as any), "unknown");
  });
});
