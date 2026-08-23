/**
 * 全局应用统一版本号管理（Single Source of Truth：根目录 VERSION 文件）
 *
 * 加载优先级：
 *  1) 构建期注入 —— tsup 构建时通过 define 将 VERSION 内容内联（生产 dist / Docker 镜像）
 *  2) 运行时读取 —— 直接读取项目根目录 VERSION 文件（开发 tsx watch / Node 直跑）
 *  3) 兜底常量   —— 由 scripts/sync-version.mjs 自动同步（Serverless 打包等极端环境保底）
 *
 * 版本升级只需修改根目录 VERSION 文件并执行 pnpm build，全系统自动同步。
 */
import { readFileSync } from "node:fs";

declare const __APP_VERSION__: string | undefined;

/** 兜底版本号（由 scripts/sync-version.mjs 从 VERSION 文件自动同步，请勿手改） */
const FALLBACK_VERSION = "3.1.0";

/** 按候选路径尝试读取 VERSION 文件，同时覆盖 src/config（开发态）与 dist（构建产物）两种运行位置 */
function loadVersionFromFile(): string | null {
  if (typeof import.meta === "undefined" || !import.meta.url) return null;
  const candidates = ["../../VERSION", "../VERSION", "../../../VERSION", "./VERSION"];
  for (const rel of candidates) {
    try {
      const raw = readFileSync(new URL(rel, import.meta.url), "utf-8").trim();
      if (/^\d+\.\d+\.\d+/.test(raw)) return raw;
    } catch {
      // 当前路径不可达，继续尝试下一个候选
    }
  }
  return null;
}

function resolveAppVersion(): string {
  try {
    // 1) tsup 构建期内联注入（未注入时 typeof 守卫不会抛 ReferenceError）
    if (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__) return __APP_VERSION__;
  } catch {
    // 防御异常运行环境，继续走文件加载
  }
  // 2) 运行时读取 VERSION 文件，失败则回退兜底常量
  return loadVersionFromFile() ?? FALLBACK_VERSION;
}

export const APP_VERSION = resolveAppVersion();
