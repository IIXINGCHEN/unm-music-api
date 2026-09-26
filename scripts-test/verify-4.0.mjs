#!/usr/bin/env node
/**
 * 修复项逻辑验证：跑真实编译产物，不 mock 业务逻辑。
 * 用法：node scripts-test/verify-4.0.mjs
 *   - 默认读取 ./dist 下的 tsc 编译产物（src/utils/utilNet.js）；缺失时自动执行 `npx tsc -p .` 构建
 *   - 可用 TEST_DIST 环境变量指定其他编译产物目录（须含 src/utils/utilNet.js）
 * 注意：`pnpm build`（tsup）只产出 dist/index.js 单文件 bundle，不含分模块产物，须用 tsc。
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
// 编译产物目录：默认 dist（tsconfig outDir），可用 TEST_DIST 覆盖
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
  const utilNetJs = `${testDist}/src/utils/utilNet.js`;
  if (!existsSync(utilNetJs)) {
    if (process.env.TEST_DIST) {
      throw new Error(`找不到 ${utilNetJs}，请先执行 npx tsc -p . --outDir "$TEST_DIST"`);
    }
    console.log("  dist 编译产物缺失，自动执行 npx tsc -p . 构建…");
    execSync("npx tsc -p tsconfig.json", { cwd: root, stdio: "inherit" });
  }
  // utilNet 经由 config 链触发 parseEnv；测试用随意密钥，避免启动期 fail-closed 直接退出
  if (!process.env.MONITOR_SECRET_KEY) {
    process.env.MONITOR_SECRET_KEY = "verify-script-dummy-key-not-for-production";
  }
  const { getClientIp, isTrustedProxy, normalizeIp } = await import(utilNetJs);

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
    getClientIp(ctx("203.0.113.9", { "x-forwarded-for": "1.1.1.1" })) === "203.0.113.9"
  );
  // 边缘头采信门（M15 修正）：仅"拿不到直连对端（Serverless）"或"对端受信"时采信。
  // 直连暴露部署下对端不受信，攻击者可自带 X-Real-IP 伪造限流身份——必须忽略，用对端 IP。
  ok(
    "直连不受信时忽略伪造 x-real-ip",
    getClientIp(ctx("203.0.113.9", { "x-real-ip": "2.2.2.2" })) === "203.0.113.9"
  );
  // 受信代理场景下边缘头仍可信（网关覆盖写入）
  ok(
    "受信代理时采信 x-real-ip",
    getClientIp(ctx("127.0.0.1", { "x-real-ip": "2.2.2.2" })) === "2.2.2.2"
  );
  // 受信代理 + 附加型 XFF：取最右非受信段（客户端伪造的最左段不再被采信）
  ok(
    "受信代理取 XFF 最右非受信段",
    getClientIp(ctx("127.0.0.1", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" })) === "10.0.0.1"
  );
  // 附加语义：客户端伪造左段 "1.2.3.4"，代理追加真实 IP，应取到真实 IP
  ok(
    "附加型 XFF 伪造左段被纠正",
    getClientIp(ctx("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 198.51.100.7" })) === "198.51.100.7"
  );
  // 受信代理无 XFF：退回对端
  ok("受信代理无头退回对端", getClientIp(ctx("127.0.0.1", {})) === "127.0.0.1");
  // Serverless 边缘头优先（边缘网关覆盖写入，客户端伪造不了）
  ok(
    "边缘头 cf-connecting-ip 优先",
    getClientIp(ctx(null, { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" })) === "198.51.100.7"
  );
  // Serverless 无任何来源：诚实返回 "unknown"，不再回退 127.0.0.1，也不再采信客户端 XFF
  ok("无 socket 无头返回 unknown", getClientIp(ctx(null, {})) === "unknown");
  ok(
    "无 socket 时不采信 XFF",
    getClientIp(ctx(null, { "x-forwarded-for": "198.51.100.7" })) === "unknown"
  );
}

// ---------- 5. 版本号 ----------
console.log("[5] 版本号三处对齐（以根目录 VERSION 为准）");
{
  const version = readFileSync(`${root}VERSION`, "utf-8").trim();
  ok(`VERSION=${version} 且为合法 semver`, /^\d+\.\d+\.\d+/.test(version));
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf-8"));
  ok(`package.json=${version}`, pkg.version === version);
  const cfg = readFileSync(`${root}src/config/configVersion.ts`, "utf-8");
  ok(`FALLBACK_VERSION=${version}`, cfg.includes(`const FALLBACK_VERSION = "${version}";`));
}

// ---------- 6. /relay 服务端中转（SSRF 防护 + 前端接入） ----------
console.log("[6] /relay 中转端点与前端接入");
{
  const src = readFileSync(`${root}src/routes/routeResource.ts`, "utf-8");
  for (const h of ["music.126.net", "joox.com", "qqmusic.qq.com"]) {
    ok(`白名单含 ${h}`, src.includes(`"${h}"`));
  }
  ok("仅允许 http/https", src.includes('u.protocol !== "http:"') && src.includes('u.protocol !== "https:"'));
  ok("禁止 URL 内嵌凭证", src.includes("u.username || u.password"));
  ok("后缀匹配防 evil-music.126.net 绕过", src.includes("h.endsWith(`.${s}`)"));
  ok("重定向手动跟随", src.includes('redirect: "manual"'));
  ok("重定向逐跳重校验白名单", src.includes("parseRelayTarget(next.toString())"));
  ok("重定向跳数上限", src.includes("RELAY_MAX_REDIRECTS = 3"));
  ok("单跳超时", src.includes("RELAY_TIMEOUT_MS = 20000"));
  ok("总大小上限 150MB", src.includes("RELAY_MAX_BYTES = 150 * 1024 * 1024"));
  ok("Range 透传（audio 拖拽）", src.includes('upstreamHeaders["Range"]'));
  ok("不转发 Referer/Origin", src.includes("不发送 Referer/Origin"));
  ok("响应头白名单透传", src.includes("RELAY_PASS_HEADERS"));
  ok("206 状态码透传", src.includes("status: upstream.status"));

  const player = readFileSync(`${root}public/assets/js/player.js`, "utf-8");
  ok("音频中转优先于换源", player.includes("'/relay?url=' + encodeURIComponent(curSrc)"));
  ok("中转只试一次/首歌", player.includes("relayTriedUrl = ''"));
  ok("封面链含中转", player.includes("'/relay?url=' + encodeURIComponent(cur)"));
  ok("AbortError 防误报保留", player.includes("err.name === 'AbortError'"));

  const html = readFileSync(`${root}public/index.html`, "utf-8");
  ok("index.html 无 Google Fonts 外链", !html.includes("fonts.googleapis.com"));
  ok("index.html 引用自托管 fonts.css", html.includes("assets/css/fonts.css"));
  const fontsCss = readFileSync(`${root}public/assets/css/fonts.css`, "utf-8");
  ok("fonts.css 含 Plus Jakarta Sans", fontsCss.includes("font-family: 'Plus Jakarta Sans'"));
  ok("fonts.css 含 JetBrains Mono", fontsCss.includes("font-family: 'JetBrains Mono'"));
  for (const f of ["plus-jakarta-sans.woff2", "jetbrains-mono-normal.woff2", "jetbrains-mono-italic.woff2"]) {
    ok(`字体文件存在 ${f}`, existsSync(`${root}public/assets/fonts/${f}`));
  }
}

console.log(`\n全部通过：${pass} 项断言`);
