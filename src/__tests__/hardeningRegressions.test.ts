import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf-8");

/**
 * 回归：UNM 特性开关的布尔映射。
 *
 * @unblockneteasemusic/server 用真值判断选择调度模式：
 *   if (process.env.SELECT_MAX_BR)            -> 并发取最高码率
 *   else if (process.env.FOLLOW_SOURCE_ORDER) -> 顺序尝试取首个成功
 *   else                                      -> Promise.any 并发竞速
 *
 * 历史缺陷：configEnv 只在为 true 时写入，于是 SELECT_MAX_BR=false 无法表达 ——
 * 要么被写成 "true"，要么保持 undefined 而落到竞速分支，FOLLOW_SOURCE_ORDER
 * 永远不可达（.env.example 把它文档化为「严格遵循音源配置顺序」）。
 * 改用 String(false) 也不行：Boolean("false") === true，同样误命中第一分支。
 * 正确映射是 true -> "true"、false -> 删除该变量。
 */
describe("布尔开关到 process.env 的映射", () => {
  const dispatch = (env: Record<string, string | undefined>) =>
    env.SELECT_MAX_BR ? "SELECT_MAX_BR" : env.FOLLOW_SOURCE_ORDER ? "FOLLOW_SOURCE_ORDER" : "race";

  const apply = (env: Record<string, string | undefined>, key: string, value: boolean) => {
    if (value) env[key] = "true";
    else delete env[key];
    return env;
  };

  test("三种组合按文档分派", () => {
    const a: Record<string, string | undefined> = {};
    apply(a, "SELECT_MAX_BR", true);
    apply(a, "FOLLOW_SOURCE_ORDER", false);
    assert.equal(dispatch(a), "SELECT_MAX_BR");

    const b: Record<string, string | undefined> = {};
    apply(b, "SELECT_MAX_BR", false);
    apply(b, "FOLLOW_SOURCE_ORDER", true);
    assert.equal(dispatch(b), "FOLLOW_SOURCE_ORDER");

    const c: Record<string, string | undefined> = {};
    apply(c, "SELECT_MAX_BR", false);
    apply(c, "FOLLOW_SOURCE_ORDER", false);
    assert.equal(dispatch(c), "race");
  });

  test("运行环境预设的旧值被清除", () => {
    const env: Record<string, string | undefined> = { SELECT_MAX_BR: "true" };
    apply(env, "SELECT_MAX_BR", false);
    assert.equal(env.SELECT_MAX_BR, undefined);
  });

  test('字符串 "false" 为真值（说明为何必须删除变量）', () => {
    assert.equal(Boolean("false"), true);
    assert.equal(dispatch({ SELECT_MAX_BR: "false" }), "SELECT_MAX_BR");
  });

  test("configEnv 使用 setBoolEnv 且不再直接赋值 String()", () => {
    const src = read("src/config/configEnv.ts");
    for (const key of ["ENABLE_FLAC", "SELECT_MAX_BR", "FOLLOW_SOURCE_ORDER", "SEARCH_ALBUM"]) {
      assert.ok(new RegExp(`setBoolEnv\\("${key}"`).test(src), `${key} 未经 setBoolEnv 映射`);
      assert.ok(
        !new RegExp(`process\\.env\\.${key}\\s*=\\s*[^;]*"true"\\s*;\\s*$`, "m").test(
          src.replace(/process\.env\[key\]/g, "")
        ),
        `${key} 仍存在“仅在 true 时写入”的旧写法`
      );
    }
    const fn = src.match(/function setBoolEnv[\s\S]*?\n\}/);
    assert.ok(fn, "未找到 setBoolEnv");
    assert.ok(/else\s*\{[\s\S]*?delete process\.env\[key\]/.test(fn![0]), "false 分支未删除变量");
  });
});

/**
 * 回归：匹配缓存键的音源列表按顺序语义条件化。
 *
 * 历史缺陷：键直接用 serverList.join(",")，`?server=a,b,c` 与 `?server=c,b,a`
 * 各占一个 key，N 个音源产生 N! 个 key（5 个即 120 个），每个 key 各自触发
 * 一整套 UNM 级联，同时击穿 LRU 与 single-flight。
 */
describe("matchSong 缓存键音源顺序", () => {
  const buildKey = (servers: string[], orderMatters: boolean) =>
    `match:id:${orderMatters ? servers.join(",") : [...servers].sort().join(",")}:320`;

  test("默认调度下不同顺序归一到同一 key", () => {
    assert.equal(
      buildKey(["joox", "netease", "kugou"], false),
      buildKey(["kugou", "joox", "netease"], false)
    );
  });

  test("5 个音源不再产生 120 个 key", () => {
    const srcs = ["gdstudio", "pyncmd", "bodian", "joox", "kugou"];
    const keys = new Set<string>();
    for (let r = 0; r < srcs.length; r++) {
      keys.add(buildKey([...srcs.slice(r), ...srcs.slice(0, r)], false));
    }
    assert.equal(keys.size, 1);
  });

  test("FOLLOW_SOURCE_ORDER 生效时保留顺序差异", () => {
    assert.notEqual(buildKey(["joox", "netease"], true), buildKey(["netease", "joox"], true));
  });

  test("serviceUnm 依据 FOLLOW_SOURCE_ORDER 条件化构造键", () => {
    const src = read("src/services/serviceUnm.ts");
    assert.ok(
      !/cacheKey = `match:\$\{cleanId\}:\$\{serverList\.join\(","\)\}/.test(src),
      "缓存键仍无条件使用客户端传入顺序"
    );
    assert.ok(src.includes("orderMatters"), "未按顺序语义条件化");
  });
});

/**
 * 回归：歌单不得伪造占位曲目。
 *
 * 历史缺陷：缺失曲目元数据时合成 "歌单曲目 #id" / artist="网易云音乐" / duration=0，
 * 其形状与真实条目一致，消费端无法区分，等于把降级结果伪装成成功。
 */
describe("歌单占位伪造", () => {
  test("不再合成占位曲目，改为 partialLoaded 声明缺口", () => {
    const src = read("src/services/serviceGdStudio.ts");
    assert.ok(
      !/name:\s*`歌单曲目 #/.test(src),
      "仍在伪造「歌单曲目 #id」占位条目"
    );
    assert.ok(src.includes("partialLoaded"), "未通过 partialLoaded 声明缺失数量");
  });

  test("PlaylistDetail 类型包含 partialLoaded", () => {
    const types = read("src/types/typeMusic.ts");
    const m = types.match(/export interface PlaylistDetail \{([\s\S]*?)\}/);
    assert.ok(m, "未找到 PlaylistDetail");
    assert.ok(/partialLoaded\??:/.test(m![1]), "PlaylistDetail 缺少 partialLoaded 字段");
  });
});

/**
 * 回归：限流豁免必须用前缀匹配，不能按后缀。
 *
 * 历史缺陷：豁免条件含 path.endsWith(".html"/".css"/".js")，
 * 于是 /match.html?id=191060 不匹配任何真实路由却因后缀而绕过限流，
 * 攻击者可无限次触发上游级联（响应 404，但上游调用已发生）。
 */
describe("限流静态豁免", () => {
  test("不再按后缀豁免", () => {
    const src = read("src/middlewares/middlewareRateLimit.ts");
    for (const ext of [".html", ".css", ".js", ".png"]) {
      assert.ok(
        !new RegExp(`path\\.endsWith\\("${ext.replace(".", "\\.")}"\\)`).test(src),
        `限流豁免仍按 ${ext} 后缀，可被 /match${ext} 绕过`
      );
    }
  });

  test("改用静态资源前缀匹配，且 /dashboard 纳入限流", () => {
    const src = read("src/middlewares/middlewareRateLimit.ts");
    assert.ok(src.includes("/assets/") && src.includes("/vendor/"), "未使用静态资源前缀");
    assert.ok(
      !/path\.startsWith\("\/dashboard"\)/.test(src),
      "/dashboard 仍被豁免限流（它是动态 HTML 路由）"
    );
  });
});
