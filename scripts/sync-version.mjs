#!/usr/bin/env node
/**
 * 版本号同步脚本：以根目录 VERSION 文件为唯一版本来源（Single Source of Truth）。
 * 自动同步四处派生位置：
 *   1) package.json 的 version 字段
 *   2) src/config/configVersion.ts 的 FALLBACK_VERSION 兜底常量
 *   3) public/*.html 静态资源的 ?v= 版本戳
 *   4) public/*.html 里 .app-version-badge 徽标文字（v<major>.<minor> PRO，不再硬编码）
 *   5) docker-compose.yml 的本地镜像标签（image: hoolhub/unm-server:<version>），与 VERSION 同源，
 *      避免引用上游远程镜像名、确保每次都是本地源码构建
 * 由 pnpm build 前的 prebuild 钩子自动触发，也可手动执行 pnpm sync:version。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const raw = readFileSync(`${root}VERSION`, "utf-8").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(raw)) {
  console.error(`[sync-version] VERSION 文件内容非法: "${raw}"，期望语义化版本号（如 3.1.0）`);
  process.exit(1);
}
const version = raw;

// 1) 同步 package.json（只读环境自动跳过，不阻断构建）
try {
  const pkgPath = `${root}package.json`;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (pkg.version !== version) {
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\
`, "utf-8");
    console.log(`[sync-version] package.json -> ${version}`);
  } else {
    console.log(`[sync-version] package.json 已对齐: ${version}`);
  }
} catch (err) {
  console.warn(`[sync-version] 跳过 package.json 同步: ${err.message}`);
}

// 2) 同步 configVersion.ts 兜底常量
const cfgPath = `${root}src/config/configVersion.ts`;
let cfg = readFileSync(cfgPath, "utf-8");
cfg = cfg.replace(/const FALLBACK_VERSION = "[^"]+";/, `const FALLBACK_VERSION = "${version}";`);
writeFileSync(cfgPath, cfg, "utf-8");
console.log(`[sync-version] configVersion.ts FALLBACK_VERSION -> ${version}`);

// 3) 静态资源版本戳：给 public/*.html 里本地 CSS/JS/vendor 引用加 ?v=版本号-构建戳。
//    每次构建戳都全局唯一（毫秒时间戳 + 6 位随机 hex），发版后浏览器与 CDN 按新 URL 拉取，
//    根治"代码已更新、页面仍用旧缓存"的问题。幂等替换：已有的 ?v=xxx 会被整体替换，不叠加。
const now = new Date();
const pad2 = (n) => String(n).padStart(2, "0");
const pad3 = (n) => String(n).padStart(3, "0");
const buildTs =
  `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
  `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}${pad3(now.getMilliseconds())}`;
const stamp = `${version}-${buildTs}-${randomBytes(3).toString("hex")}`;
const htmlFiles = ["public/index.html", "public/dashboard.html"];
const stampRe = /((?:src|href)="\.?\/(?:assets|vendor)\/[^"?]+)(\?v=[^"]*)?(")/g;
for (const f of htmlFiles) {
  const p = `${root}${f}`;
  const html = readFileSync(p, "utf-8");
  const stamped = html.replace(stampRe, `$1?v=${stamp}$3`);
  if (stamped !== html) {
    writeFileSync(p, stamped, "utf-8");
    console.log(`[sync-version] ${f} 静态资源已加版本戳 ?v=${stamp}`);
  } else {
    console.log(`[sync-version] ${f} 版本戳已是最新: ?v=${stamp}`);
  }
}

// 4) 前端版本徽标：public/*.html 里 .app-version-badge 的 "vX.Y PRO" 硬编码
//    改为从 VERSION 文件派生（v<major>.<minor> PRO），与后端 /info 版本同源。
//    幂等替换：已对齐时不改写文件。
const shortVer = version.split(".").slice(0, 2).join(".");
const badgeRe = /(<span class="app-version-badge[^"]*">)v\d+\.\d+ PRO(<\/span>)/g;
for (const f of htmlFiles) {
  const p = `${root}${f}`;
  const html = readFileSync(p, "utf-8");
  const updated = html.replace(badgeRe, `$1v${shortVer} PRO$2`);
  if (updated !== html) {
    writeFileSync(p, updated, "utf-8");
    console.log(`[sync-version] ${f} 版本徽标已同步: v${shortVer} PRO`);
  } else {
    console.log(`[sync-version] ${f} 版本徽标已对齐: v${shortVer} PRO`);
  }
}

// 5) docker-compose.yml 本地镜像标签：image: hoolhub/unm-server:<version>
//    本地构建、本地命名，不再引用上游远程镜像，确保部署用的永远是当前源码构建的镜像。
//    幂等替换：兼容旧的 ghcr.io 远端名，首次运行即迁移为本地名。
//    构建环境（如 Docker builder 阶段）可能没有该文件，缺失时跳过、不阻断构建。
const composePath = `${root}docker-compose.yml`;
try {
  let compose = readFileSync(composePath, "utf-8");
  const composeUpdated = compose.replace(
    /^[ \t]*image:[ \t]*\S+[ \t]*$/m,
    `    image: hoolhub/unm-server:${version}`
  );
  if (composeUpdated !== compose) {
    writeFileSync(composePath, composeUpdated, "utf-8");
    console.log(`[sync-version] docker-compose.yml 镜像标签 -> hoolhub/unm-server:${version}`);
  } else {
    console.log(`[sync-version] docker-compose.yml 镜像标签已对齐: hoolhub/unm-server:${version}`);
  }
} catch (err) {
  console.warn(`[sync-version] 跳过 docker-compose.yml 同步（构建环境无此文件）: ${err.message}`);
}

console.log(`[sync-version] 全部版本号已与根目录 VERSION 文件对齐: v${version}`);
