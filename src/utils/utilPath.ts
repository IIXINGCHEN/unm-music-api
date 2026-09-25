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
 *
 * 路径穿越防护：names 中即使包含 "../" 或绝对路径，解析结果也必须落在候选
 * public 目录之内，否则该候选直接跳过，绝不返回目录之外的路径。
 */
export function resolvePublicFile(...names: string[]): string | null {
  const modDir = getModuleDir();
  const bases: (string | null | undefined)[] = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "src", "public"),
    path.resolve(process.cwd(), "..", "public"),
    path.resolve(process.cwd(), "..", "src", "public"),
    path.resolve(path.dirname(process.argv[1] || process.cwd()), "public"),
    modDir ? path.resolve(modDir, "public") : null,
    modDir ? path.resolve(modDir, "../public") : null,
    modDir ? path.resolve(modDir, "../../public") : null,
  ];

  for (const base of bases) {
    if (!base) continue;
    const full = path.resolve(base, ...names);
    // containment 校验：必须位于 base 之内（含 base 本身）
    if (full !== base && !full.startsWith(base + path.sep)) continue;
    if (fsSync.existsSync(full)) {
      return full;
    }
  }
  return null;
}
