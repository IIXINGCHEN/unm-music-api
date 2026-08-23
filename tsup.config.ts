import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// 构建时从根目录 VERSION 文件读取统一版本号并内联注入（单一版本来源）
const appVersion = (() => {
  try {
    return readFileSync(new URL("./VERSION", import.meta.url), "utf-8").trim();
  } catch {
    return undefined;
  }
})();

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: true,
  minify: false,
  splitting: false,
  shims: true,
  define: appVersion ? { __APP_VERSION__: JSON.stringify(appVersion) } : {},
});
