// 自托管字体同步：从 Google Fonts 拉取 latin 子集 woff2 并生成本地 fonts.css。
// 中文等非 latin 字形由系统字体栈回退，不入库。重新生成：node scripts/sync-fonts.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";
// 带 Chrome UA 才会返回 woff2（可变字体）格式的字体文件
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const OUT_DIR = "public/assets/fonts";
const OUT_CSS = "public/assets/css/fonts.css";

const res = await fetch(FONTS_CSS_URL, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error("拉取字体 CSS 失败: " + res.status);
const css = await res.text();

// 按子集注释切分 @font-face 块，仅保留 latin 子集
const blockRe = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;
const faces = new Map(); // key: family|style|url
for (const [, subset, body] of css.matchAll(blockRe)) {
  if (subset !== "latin") continue;
  const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
  const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? "normal";
  const weight = body.match(/font-weight:\s*([\d]+)/)?.[1];
  const url = body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
  if (!family || !weight || !url) throw new Error("字体块解析失败: " + body.slice(0, 80));
  const key = family + "|" + style + "|" + url;
  const face = faces.get(key) ?? { family, style, url, unicodeRange, weights: [] };
  face.weights.push(Number(weight));
  faces.set(key, face);
}

await mkdir(OUT_DIR, { recursive: true });
let cssOut = "/* 由 scripts/sync-fonts.mjs 生成，勿手改；仅 latin 子集，其余字形回退系统字体 */\n";
let totalBytes = 0;
for (const face of faces.values()) {
  const file =
    face.family.toLowerCase().replace(/ /g, "-") + (face.style === "italic" ? "-italic" : "") + ".woff2";
  const bin = await (await fetch(face.url, { headers: { "User-Agent": UA } })).arrayBuffer();
  await writeFile(path.join(OUT_DIR, file), Buffer.from(bin));
  totalBytes += bin.byteLength;
  const weights = [...new Set(face.weights)].sort((a, b) => a - b);
  const weightDecl =
    weights.length > 1 ? weights[0] + " " + weights[weights.length - 1] : String(weights[0]);
  cssOut +=
    "\n@font-face {\n" +
    "  font-family: '" + face.family + "';\n" +
    "  font-style: " + face.style + ";\n" +
    "  font-weight: " + weightDecl + ";\n" +
    "  font-display: swap;\n" +
    "  src: url('../fonts/" + file + "') format('woff2');\n" +
    "  unicode-range: " + face.unicodeRange + ";\n" +
    "}\n";
  console.log(file + ": " + (bin.byteLength / 1024).toFixed(1) + " KB (" + face.family + " " + face.style + " " + weightDecl + ")");
}
await writeFile(OUT_CSS, cssOut);
console.log("共 " + faces.size + " 个字体文件，" + (totalBytes / 1024).toFixed(1) + " KB；已生成 " + OUT_CSS);
