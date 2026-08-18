import { Hono } from "hono";
import { z } from "zod";
import { env, PROVIDER_CONFIG } from "../config/index.js";
import { matchSong, getNeteaseSong, getOtherSourceSong } from "../services/unm.js";
import { successResponse, errorResponse } from "../utils/response.js";
import type { ApiResponse } from "../types/api.js";
import type { MatchedAudio, NcmAudioResult } from "../types/music.js";

const musicRoute = new Hono();

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

// 快速匹配测试 (/test)
musicRoute.get("/test", async (c) => {
  try {
    const data = await matchSong(env.DEFAULT_TEST_SONG_ID, [...PROVIDER_CONFIG.PRIMARY_DECRYPT_PROVIDERS]);
    (c as any).set?.("matchedSource", data.source);
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
    (c as any).set?.("matchedSource", data.source);
    return c.json<ApiResponse<MatchedAudio>>(successResponse(data, "匹配成功"));
  } catch (error: any) {
    console.error(`[Match Error] id=${id}:`, error.message);
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
    console.error(`[NcmGet Error] id=${id}:`, error.message);
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
    console.error(`[OtherGet Error] name=${name}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取其他音源失败: ${error.message}`), 500);
  }
});

export { musicRoute };
