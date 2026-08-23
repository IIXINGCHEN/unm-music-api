#!/usr/bin/env node
/**
 * 一键发布脚本：以根目录 VERSION 文件为唯一版本来源。
 *
 * 用法：
 *   pnpm release            # 交互式确认当前 VERSION 直接发布
 *   pnpm release patch      # 3.1.0 -> 3.1.1
 *   pnpm release minor      # 3.1.0 -> 3.2.0
 *   pnpm release major      # 3.1.0 -> 4.0.0
 *   pnpm release 3.2.0      # 显式指定版本号
 *   pnpm release --dry-run  # 只演练，不落盘不推送
 *
 * 流程：
 *   1) 前置校验（main 分支 / 工作区干净 / 与远端同步 / 提交签名已开启）
 *   2) 计算新版本并写入 VERSION，执行 sync:version 对齐 package.json 与 configVersion.ts
 *   3) 以 chore(release): vX.Y.Z 提交（遵循仓库级 commit.gpgsign 签名）
 *   4) 创建带签名的附注标签 vX.Y.Z 并推送 main + 标签
 *   5) 推送后由 GitHub Actions 自动完成 Docker 镜像构建与 GitHub Release 发布
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpArg = args.find((a) => !a.startsWith("--")) || "";

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf-8" }).trim();
const log = (msg) => console.log(`[release] ${msg}`);
const die = (msg) => {
  console.error(`[release] ❌ ${msg}`);
  process.exit(1);
};

// ---------- 1) 前置校验 ----------
const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`必须在 main 分支上发布，当前分支: ${branch}`);

const status = sh("git status --porcelain");
if (status) die(`工作区存在未提交改动，请先提交或暂存：\n${status}`);

sh("git fetch origin --tags --quiet");
const ahead = sh("git rev-list --count origin/main..HEAD");
const behind = sh("git rev-list --count HEAD..origin/main");
if (ahead !== "0" || behind !== "0") die(`本地与 origin/main 不同步（ahead=${ahead} behind=${behind}），请先 push/pull`);

if (sh("git config --get commit.gpgsign || echo notset") !== "true")
  die("未开启提交签名（commit.gpgsign），请先配置 SSH 签名再发布");

// ---------- 2) 计算新版本 ----------
const current = readFileSync(`${root}VERSION`, "utf-8").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(current))
  die(`VERSION 文件内容非法: "${current}"`);

let next = current;
if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
  next = bumpArg;
} else if (bumpArg) {
  if (!["patch", "minor", "major"].includes(bumpArg)) die(`未知参数: ${bumpArg}（支持 patch/minor/major 或 x.y.z）`);
  const [maj, min, pat] = current.split(".").map(Number);
  next =
    bumpArg === "major" ? `${maj + 1}.0.0`
    : bumpArg === "minor" ? `${maj}.${min + 1}.0`
    : `${maj}.${min}.${pat + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) die(`目标版本非法: ${next}`);
const tag = `v${next}`;

// 本地与远端标签都必须不存在
for (const scope of ["", "origin/"]) {
  let exists = false;
  try {
    sh(`git rev-parse --verify --quiet ${scope}refs/tags/${tag}`);
    exists = true;
  } catch {}
  if (exists) die(`标签 ${tag} 已存在于 ${scope ? "远端" : "本地"}`);
}

console.log("");
log(`当前版本: v${current}`);
log(`目标版本: v${next}`);
log(`演练模式: ${dryRun ? "是" : "否"}`);
console.log("");

// ---------- 3) 写版本 + 同步派生位置 ----------
writeFileSync(`${root}VERSION`, `${next}\n`, "utf-8");
log(`VERSION -> ${next}`);

sh("node scripts/sync-version.mjs");

// ---------- 4) 提交 + 打签名的附注标签 ----------
sh("git add VERSION package.json src/config/configVersion.ts");
sh(`git commit -m "chore(release): ${tag} 版本发布"`);
log(`已创建签名提交: ${tag}`);

sh(`git tag -a ${tag} -m "${tag}"`);
log(`已创建签名标签: ${tag}`);

// ---------- 5) 推送或回滚 ----------
if (dryRun) {
  log("dry-run 模式：撤销本地提交与标签后结束");
  sh("git reset --hard HEAD~1");
  sh(`git tag -d ${tag}`);
  sh("node scripts/sync-version.mjs");
  log("已恢复到发布前状态");
  process.exit(0);
}

sh("git push origin main");
sh(`git push origin ${tag}`);
log(`已推送 main 与标签 ${tag}`);
console.log("");
log("✅ GitHub Actions 将自动执行：Docker 多架构镜像构建 + GitHub Release 发布");
log("   https://github.com/IIXINGCHEN/unm-music-api/actions");
log(`   https://github.com/IIXINGCHEN/unm-music-api/releases/tag/${tag}`);
