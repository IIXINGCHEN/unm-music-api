#!/usr/bin/env node
/**
 * v4.0 修复项逻辑验证：跑真实编译产物，不 mock 业务逻辑。
 * 用法：先 pnpm build（或 tsc），再 node scripts-test/verify-4.0.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
// 编译产物目录：默认 dist，可用 TEST_DIST 覆盖（如 tsc --outDir .test-dist）
const testDist = process.env.TEST_DIST || `${root}dist`;
let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. escapeHtml（从真实文件提取后求值） ----------
console.log("[1] escapeHtml 真实实现");
for (const f of ["public/assets/js/dashboard.js", "public/assets/js/core.js"]) {
  const src = readFileSync(`${root}${f}`, "utf-8");
  const m = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n    \}/);
  assert.ok(m, `${f} 必须包含 escapeHtml`);
  const escapeHtml = eval(`(${m[0].replace("function escapeHtml", "function")})`);
  ok(`${f}: <script> 被转义`, escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');
  ok(`${f}: 引号/& 被转义`, escapeHtml('"a\'b&c"') === '&quot;a&#39;b&amp;c&quot;');
  ok(`${f}: null/undefined 安全`, escapeHtml(null) === '' && escapeHtml(undefined) === '');
  ok(`${f}: 普通文本不变`, escapeHtml('GET /match 200') === 'GET /match 200');
}

// ---------- 2. dashboard.js 渲染点全部转义 ----------
console.log("[2] dashboard.js 渲染转义覆盖");
{
  const src = readFileSync(`${root}public/assets/js/dashboard.js`, "utf-8");
  for (const field of ["l.timeStr", "l.method", "l.path", "l.referer", "l.clientType", "l.ip", "item.name"]) {
    ok(`escapeHtml(${field})`, src.includes(`escapeHtml(${field})`));
  }
  ok("showToast 内 title/message 转义", src.includes("${escapeHtml(title)}") && src.includes("${escapeHtml(message)}"));
}

// ---------- 3. Toast 收敛 ----------
console.log("[3] Toast 收敛");
{
  const src = readFileSync(`${root}public/assets/js/dashboard.js`, "utf-8");
  for (const noise of ["面板展开", "面板折叠", "布局模式", "轮询配置", "轮询已暂停", "筛选检索", "过滤条件已更新", "分页切换", "明细展开"]) {
    ok(`无 "${noise}" 噪音 toast`, !src.includes(noise));
  }
  for (const keep of ["清空完成", "导出成功", "需要鉴权", "凭证已保存"]) {
    ok(`保留 "${keep}" 结果反馈`, src.includes(keep));
  }
}

// ---------- 4. utilNet 可信代理链（真实编译产物） ----------
console.log("[4] utilNet.getClientIp / isTrustedProxy");
{
  const { getClientIp, isTrustedProxy, normalizeIp } = await import(`${testDist}/src/utils/utilNet.js`);

  ok("normalizeIp 剥离 ::ffff:", normalizeIp("::ffff:1.2.3.4") === "1.2.3.4");
  ok("默认信任 127.0.0.1", isTrustedProxy("127.0.0.1") === true);
  ok("默认信任 ::1", isTrustedProxy("::1") === true);
  ok("默认信任 ::ffff:127.0.0.1", isTrustedProxy("::ffff:127.0.0.1") === true);
  ok("公网 IP 不受信", isTrustedProxy("203.0.113.9") === false);

  const ctx = (peer, headers = {}) => ({
    env: peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
    req: { header: (k) => headers[k.toLowerCase()] ?? null },
  });

  // 直连公网：伪造 XFF 必须被忽略
  ok(
    "直连时忽略伪造 XFF",
    getClientIp(ctx("203.0.113.9", { "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" })) === "203.0.113.9"
  );
  // 受信本地代理：采信 XFF 最左端
  ok(
    "受信代理采信 XFF",
    getClientIp(ctx("127.0.0.1", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" })) === "198.51.100.7"
  );
  // 受信代理无 XFF：退回对端
  ok("受信代理无头退回对端", getClientIp(ctx("127.0.0.1", {})) === "127.0.0.1");
  // Serverless（无 socket）：退化旧行为
  ok(
    "无 socket 退化取 XFF",
    getClientIp(ctx(null, { "x-forwarded-for": "198.51.100.7" })) === "198.51.100.7"
  );
  ok("无 socket 无头兜底", getClientIp(ctx(null, {})) === "127.0.0.1");
}

// ---------- 5. 版本号 ----------
console.log("[5] 版本 4.0 对齐");
{
  ok("VERSION=4.0.0", readFileSync(`${root}VERSION`, "utf-8").trim() === "4.0.0");
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf-8"));
  ok("package.json=4.0.0", pkg.version === "4.0.0");
  const cfg = readFileSync(`${root}src/config/configVersion.ts`, "utf-8");
  ok("FALLBACK_VERSION=4.0.0", cfg.includes('const FALLBACK_VERSION = "4.0.0";'));
}

console.log(`\n全部通过：${pass} 项断言`);
