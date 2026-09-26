import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { env, PROVIDER_CONFIG } from "../config/index.js";
import { matchSong, getNeteaseSong, getOtherSourceSong } from "../services/serviceUnm.js";
import { successResponse, errorResponse } from "../utils/utilResponse.js";
import { sanitizeLogParam } from "../utils/utilString.js";
import { getClientIp } from "../utils/utilNet.js";
import type { ApiResponse, AppEnv } from "../types/typeApi.js";
import type { MatchedAudio, NcmAudioResult } from "../types/typeMusic.js";

const musicRoute = new Hono<AppEnv>();

/**
 * /test 专用紧限流：该端点公开可调且每次调用都会触发完整匹配链路
 * （含第三方签名直链 mint），用独立小桶 10 次/分钟/IP 防止匿名滥用。
 * 与全局限流中间件隔离，避免互相干扰计数。
 */
const testRateMap = new Map<string, number[]>();
const TEST_RATE_WINDOW_MS = 60 * 1000;
const TEST_RATE_MAX = 10;
/** F-006：/test 限流表同样加键数上限（近似 LRU），与全局限流表同理 */
export const TEST_RATE_MAX_KEYS = 1000;
const testRateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of testRateMap.entries()) {
    const fresh = ts.filter((t) => now - t < TEST_RATE_WINDOW_MS);
    if (fresh.length === 0) testRateMap.delete(ip);
    else testRateMap.set(ip, fresh);
  }
}, TEST_RATE_WINDOW_MS);
if (typeof testRateCleanup.unref === "function") testRateCleanup.unref();

async function testRateLimit(c: Context<AppEnv>, next: Next) {
  const ip = getClientIp(c);
  const now = Date.now();
  const hit = testRateMap.get(ip);
  const ts = (hit ?? []).filter((t) => now - t < TEST_RATE_WINDOW_MS);
  if (ts.length >= TEST_RATE_MAX) {
    return c.json<ApiResponse>(
      errorResponse(429, "Too Many Requests: /test 调用过于频繁，请稍后再试"),
      429
    );
  }
  ts.push(now);
  // F-006：键数上限（近似 LRU）；命中键刷新 recency，新键超限时淘汰最老键
  if (hit) {
    testRateMap.delete(ip);
  } else if (testRateMap.size >= TEST_RATE_MAX_KEYS) {
    const oldest = testRateMap.keys().next();
    if (!oldest.done) testRateMap.delete(oldest.value);
  }
  testRateMap.set(ip, ts);
  await next();
}

const matchSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(50),
  server: z.string().max(200).optional(),
  br: z.string().max(10).optional(),
});

const ncmgetSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(50),
  br: z.string().max(10).optional(),
});

const othergetSchema = z.object({
  name: z.string().min(1, "缺少 name 参数").max(100),
});

// 快速匹配测试 (/test)：保留公开 demo 功能，但加独立紧限流防匿名滥用
musicRoute.get("/test", testRateLimit, async (c) => {
  try {
    const data = await matchSong(env.DEFAULT_TEST_SONG_ID, [...PROVIDER_CONFIG.PRIMARY_DECRYPT_PROVIDERS]);
    c.set("matchedSource", data.source);
    return c.json<ApiResponse<MatchedAudio>>(successResponse(data, "测试匹配成功"));
  } catch (error: any) {
    return c.json<ApiResponse>(errorResponse(500, `测试匹配失败: ${error.message}`), 500);
  }
});

// 核心歌曲解灰匹配 (/match)
musicRoute.get("/match", async (c) => {
  const query = c.req.query();
  const parsed = matchSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { id, server: rawServer, br } = parsed.data;
  const servers = rawServer ? rawServer.split(",").map((s) => s.trim()).filter(Boolean) : null;

  try {
    const data = await matchSong(id, servers, br || env.DEFAULT_BITRATE);
    c.set("matchedSource", data.source);
    return c.json<ApiResponse<MatchedAudio>>(successResponse(data, "匹配成功"));
  } catch (error: any) {
    console.error(`[Match Error] id=${sanitizeLogParam(id)}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `匹配失败: ${error.message}`), 500);
  }
});

// 网易云歌曲直链获取 (/ncmget)
musicRoute.get("/ncmget", async (c) => {
  const query = c.req.query();
  const parsed = ncmgetSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { id, br } = parsed.data;
  try {
    const data = await getNeteaseSong(id, br || env.DEFAULT_BITRATE);
    return c.json<ApiResponse<NcmAudioResult>>(successResponse(data));
  } catch (error: any) {
    console.error(`[NcmGet Error] id=${sanitizeLogParam(id)}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取网易云音乐失败: ${error.message}`), 500);
  }
});

// 其他音源获取 (/otherget)
musicRoute.get("/otherget", async (c) => {
  const query = c.req.query();
  const parsed = othergetSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { name } = parsed.data;
  try {
    const data = await getOtherSourceSong(name);
    return c.json<ApiResponse<{ url: string; source: string }>>(successResponse(data));
  } catch (error: any) {
    console.error(`[OtherGet Error] name=${sanitizeLogParam(name)}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取其他音源失败: ${error.message}`), 500);
  }
});

export { musicRoute };
