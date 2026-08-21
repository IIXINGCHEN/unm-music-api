import { Hono, type Context } from "hono";
import { z } from "zod";
import { env, AUDIO_CONFIG } from "../config/index.js";
import { gdStudio } from "../services/serviceGdStudio.js";
import { successResponse, errorResponse } from "../utils/utilResponse.js";
import type { ApiResponse } from "../types/typeApi.js";
import type { GDTrack, GDPicResponse, LyricResult } from "../types/typeMusic.js";

const resourceRoute = new Hono();

const searchSchema = z.object({
  name: z.string().min(1, "缺少 name 参数").max(100),
  source: z.string().max(30).optional(),
  count: z.string().optional().transform((val) => (val ? parseInt(val, 10) : env.DEFAULT_SEARCH_COUNT)),
  pages: z.string().optional(),
  page: z.string().optional(),
});

const picSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
  size: z.string().optional().transform((val) => (val ? parseInt(val, 10) : env.DEFAULT_PICTURE_SIZE)),
});

const lyricSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
});

// 跨平台歌曲搜索 (/search)
resourceRoute.get("/search", async (c) => {
  const query = c.req.query();
  const parsed = searchSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { name, source, count, pages, page } = parsed.data;
  const pageNum = parseInt(pages || page || "1", 10) || AUDIO_CONFIG.DEFAULT_SEARCH_PAGE;

  try {
    const results = await gdStudio.search(name, source || env.DEFAULT_SEARCH_SOURCE, count, pageNum);
    return c.json<ApiResponse<GDTrack[]>>(successResponse(results, "搜索成功"));
  } catch (error: any) {
    console.error(`[Search Error] name=${name}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `搜索失败: ${error.message}`), 500);
  }
});

// 专辑封面图获取 (/pic 与 /picture)
const handlePicture = async (c: Context) => {
  const query = c.req.query();
  const parsed = picSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { id, source, size } = parsed.data;
  try {
    const data = await gdStudio.getPic(id, source || env.DEFAULT_SEARCH_SOURCE, size);
    if (!data || !data.url) {
      return c.json<ApiResponse>(errorResponse(404, "未找到专辑封面"), 404);
    }

    return c.json<ApiResponse<GDPicResponse>>(successResponse(data));
  } catch (error: any) {
    console.error(`[Picture Error] id=${id}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取封面失败: ${error.message}`), 500);
  }
};

resourceRoute.get("/pic", handlePicture);
resourceRoute.get("/picture", handlePicture);

// 歌词获取 (/lyric)
resourceRoute.get("/lyric", async (c) => {
  const query = c.req.query();
  const parsed = lyricSchema.safeParse(query);
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }

  const { id, source } = parsed.data;
  try {
    const data = await gdStudio.getLyric(id, source || env.DEFAULT_SEARCH_SOURCE);
    return c.json<ApiResponse<LyricResult>>(successResponse(data));
  } catch (error: any) {
    console.error(`[Lyric Error] id=${id}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取歌词失败: ${error.message}`), 500);
  }
});

// 歌单歌曲 ID 列表获取 (/playlist/:id)
resourceRoute.get("/playlist/:id", async (c) => {
  const playlistId = c.req.param("id")?.trim();
  if (!playlistId) {
    return c.json<ApiResponse>(errorResponse(400, "无效的歌单 ID"), 400);
  }

  try {
    const songIds = await gdStudio.getPlaylistSongIds(playlistId);
    if (!songIds || songIds.length === 0) {
      return c.json<ApiResponse>(errorResponse(404, "未找到该歌单或歌单为空"), 404);
    }

    return c.json<ApiResponse<string[]>>(successResponse(songIds, "获取歌单歌曲ID成功"));
  } catch (error: any) {
    console.error(`[Playlist Error] id=${playlistId}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取歌单失败: ${error.message}`), 500);
  }
});

export { resourceRoute };
