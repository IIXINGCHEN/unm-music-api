import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolvePublicFile } from "../utils/utilPath.js";
import { STREAM_CONFIG, RATE_LIMIT_CONFIG } from "../config/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf-8");

/**
 * 回归：静态资源路径解析必须做 containment 校验。
 *
 * 当前所有调用点都传硬编码常量，故不可利用；但该函数是公开导出的，
 * 一旦有调用点传入用户输入（如按路径参数回源），缺少校验即为路径穿越。
 */
describe("resolvePublicFile 越界防护", () => {
  test("正常静态资源仍可解析（无回归）", () => {
    for (const f of [
      "index.html",
      "dashboard.html",
      "404.html",
      "assets/css/main.css",
      "assets/js/core.js",
    ]) {
      assert.ok(resolvePublicFile(f), `应能解析: ${f}`);
    }
  });

  test("越界路径被拒绝", () => {
    for (const bad of [
      "../package.json",
      "../../etc/passwd",
      "assets/../../package.json",
      "../../../.env",
    ]) {
      assert.equal(resolvePublicFile(bad), null, `越界路径未被拒绝: ${bad}`);
    }
  });
});

/**
 * 回归：限流追踪表打满时淘汰最旧键，而不是放行新键。
 *
 * 原实现打满后直接 next()，于是攻击者只要制造 MAX_IP_KEYS 个不同键
 * （受信代理部署下用单个连接伪造 XFF 即可），此后所有客户端都不再受限流保护 ——
 * 防内存膨胀的代价是关掉了防护本身。
 */
describe("限流键容量策略", () => {
  /** 复现中间件中的淘汰逻辑 */
  const makeTracker = (max: number) => {
    const m = new Map<string, number[]>();
    const touch = (key: string) => {
      if (!m.has(key)) {
        if (m.size >= max) {
          const oldest = m.keys().next().value;
          if (oldest !== undefined) m.delete(oldest);
        }
        m.set(key, []);
      }
      return m.has(key);
    };
    return { m, touch };
  };

  test("容量达到上限后不再增长", () => {
    const { m, touch } = makeTracker(3);
    for (const k of ["a", "b", "c", "d", "e", "f"]) touch(k);
    assert.equal(m.size, 3);
  });

  test("最旧键被淘汰，新键仍被记录（即受限流而非放行）", () => {
    const { m, touch } = makeTracker(3);
    for (const k of ["a", "b", "c"]) touch(k);
    assert.equal(touch("d"), true, "新键应被记录以接受限流");
    assert.equal(m.has("a"), false, "最旧键应被淘汰");
    assert.equal(m.has("d"), true);
  });

  test("中间件不得在容量打满时放行请求", () => {
    const src = read("src/middlewares/middlewareRateLimit.ts");
    // 打满即 return await next() 是旧实现；现在应为淘汰最旧键
    const capBlock = src.match(/ipMap\.size >= RATE_LIMIT_CONFIG\.MAX_IP_KEYS[\s\S]{0,400}/);
    assert.ok(capBlock, "未找到容量上限处理块");
    assert.ok(
      !/return await next\(\)/.test(capBlock![0].split("ipMap.set")[0] ?? ""),
      "容量打满时仍在放行请求（应改为淘汰最旧键）"
    );
    assert.ok(
      /ipMap\.delete\(oldestKey\)/.test(capBlock![0]),
      "未淘汰最旧键"
    );
  });
});

/**
 * 回归：/stream 的重定向必须逐跳校验，且连接阶段有独立超时。
 *
 * 原实现用 redirect: "follow"，白名单只覆盖初始 URL ——
 * 上游返回 302 指向内网即可绕过白名单（SSRF）。
 * 另外 fetch 只挂了客户端断开信号，客户端保持连接而上游挂起时会无限期占用资源。
 */
describe("/stream 中转约束", () => {
  test("使用 manual 重定向并校验每一跳", () => {
    const src = read("src/routes/routeMusic.ts");
    // 只检查实际代码行：注释里会引用旧实现（`// 原实现用 redirect: "follow"`），
    // 一刀切的正则会被注释误判。
    const codeLines = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const code = codeLines.join("\n");

    assert.ok(
      !/redirect:\s*"follow"/.test(code),
      '实际代码仍使用 redirect: "follow"，白名单只覆盖首跳'
    );
    assert.ok(/redirect:\s*"manual"/.test(code), '未改为 redirect: "manual"');
    // 跳转目标必须重新过白名单
    assert.ok(
      /isRegisteredStreamUrl\(nextUrl/.test(code),
      "重定向目标未重新校验白名单"
    );
  });

  test("连接阶段有独立超时（不依赖客户端断开）", () => {
    const src = read("src/routes/routeMusic.ts");
    assert.ok(/STREAM_CONNECT_TIMEOUT_MS/.test(src), "缺少连接阶段超时");
    assert.ok(/connectAbort/.test(src), "未使用独立的 AbortController");
    assert.ok(
      /clearTimeout\(connectTimer\)/.test(src),
      "连接超时未在拿到响应后清除，会误伤后续流式传输"
    );
  });

  test("重定向跳数有上限", () => {
    assert.ok(STREAM_CONFIG.MAX_REDIRECTS > 0 && STREAM_CONFIG.MAX_REDIRECTS <= 5);
    const src = read("src/routes/routeMusic.ts");
    assert.ok(/STREAM_MAX_REDIRECTS/.test(src), "未限制重定向跳数");
  });

  test("限流追踪表上限仍为正值（策略变更未移除上限）", () => {
    assert.ok(RATE_LIMIT_CONFIG.MAX_IP_KEYS > 0);
  });
});
