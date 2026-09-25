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
 * 纵深防御：`names` 当前所有调用点都是硬编码常量，但此函数是公开导出的，
 * 一旦将来有调用点把用户输入传进来（例如按路径参数回源静态文件），
 * 未做 containment 校验就会直接变成路径穿越漏洞。故对每个候选结果校验
 * 其解析后仍位于对应 public 根目录之内，否则跳过该候选。
 */
export function resolvePublicFile(...names: string[]): string | null {
  const modDir = getModuleDir();
  const roots: (string | null | undefined)[] = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "src", "public"),
    path.resolve(process.cwd(), "..", "public"),
    path.resolve(process.cwd(), "..", "src", "public"),
    path.resolve(path.dirname(process.argv[1] || process.cwd()), "public"),
    modDir ? path.resolve(modDir, "public") : null,
    modDir ? path.resolve(modDir, "../public") : null,
    modDir ? path.resolve(modDir, "../../public") : null,
  ];

  for (const root of roots) {
    if (!root) continue;
    const full = path.resolve(root, ...names);
    // containment：结果必须落在该 public 根之内（含根本身）。
    // 比较前统一分隔符与大小写，避免 Windows 下的路径差异造成误判。
    const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
    const sameOrInside =
      full === root ||
      full.startsWith(normalizedRoot) ||
      // Windows 大小写不敏感，且 path.resolve 可能产出不同盘符大小写
      (process.platform === "win32" &&
        full.toLowerCase().startsWith(normalizedRoot.toLowerCase()));
    if (!sameOrInside) {
      console.warn(`[Static] 拒绝越界路径解析: ${names.join("/")} -> ${full}`);
      continue;
    }
    if (fsSync.existsSync(full)) {
      return full;
    }
  }
  return null;
}
