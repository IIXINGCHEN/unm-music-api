import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 安全获取当前模块所在目录路径（兼顾 ESM 原生执行与 CJS / Serverless 打包环境）
 */
export function getModuleDir(importMetaUrl?: string): string | null {
  try {
    if (typeof importMetaUrl === "string" && importMetaUrl) {
      return path.dirname(fileURLToPath(importMetaUrl));
    }
    if (typeof import.meta.url === "string" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    /* import.meta 不可用 */
  }

  const anyMod = globalThis as any;
  if (typeof anyMod.__filename === "string") {
    return path.dirname(anyMod.__filename);
  }
  return null;
}

/**
 * 解析并定位静态资源文件路径（兼容本地 cwd、dist 编译目录及各类 Serverless 运行时）
 */
export function resolvePublicFile(...names: string[]): string | null {
  const modDir = getModuleDir();
  const candidates: (string | null | undefined)[] = [
    path.resolve(process.cwd(), "public", ...names),
    path.resolve(process.cwd(), "src", "public", ...names),
    path.resolve(process.cwd(), "..", "public", ...names),
    path.resolve(process.cwd(), "..", "src", "public", ...names),
    path.resolve(path.dirname(process.argv[1] || process.cwd()), "public", ...names),
    modDir ? path.resolve(modDir, "public", ...names) : null,
    modDir ? path.resolve(modDir, "../public", ...names) : null,
    modDir ? path.resolve(modDir, "../../public", ...names) : null,
  ];

  for (const p of candidates) {
    if (p && fsSync.existsSync(p)) {
      return p;
    }
  }
  return null;
}
