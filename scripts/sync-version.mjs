#!/usr/bin/env node
/**
 * 版本号同步脚本：以根目录 VERSION 文件为唯一版本来源（Single Source of Truth）。
 * 自动同步两处派生位置：
 *   1) package.json 的 version 字段
 *   2) src/config/configVersion.ts 的 FALLBACK_VERSION 兜底常量
 * 由 pnpm build 前的 prebuild 钩子自动触发，也可手动执行 pnpm sync:version。
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const FALLBACK_PATTERN = /const FALLBACK_VERSION = "[^"]+";/;
if (!FALLBACK_PATTERN.test(cfg)) {
  console.error("[sync-version] configVersion.ts 中未找到 FALLBACK_VERSION 声明，请检查文件是否被改动");
  process.exit(1);
}
cfg = cfg.replace(FALLBACK_PATTERN, `const FALLBACK_VERSION = "${version}";`);
writeFileSync(cfgPath, cfg, "utf-8");
console.log(`[sync-version] configVersion.ts FALLBACK_VERSION -> ${version}`);

console.log(`[sync-version] 全部版本号已与根目录 VERSION 文件对齐: v${version}`);
