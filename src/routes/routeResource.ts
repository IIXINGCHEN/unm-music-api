import { Hono, type Context } from "hono";
import { z } from "zod";
import { env, AUDIO_CONFIG, PLAYLIST_CONFIG } from "../config/index.js";
import { gdStudio } from "../services/serviceGdStudio.js";
import { successResponse, errorResponse, parseQuery } from "../utils/utilResponse.js";
import type { ApiResponse } from "../types/typeApi.js";
import type { GDTrack, GDPicResponse, LyricResult, PlaylistDetail } from "../types/typeMusic.js";

const resourceRoute = new Hono();

const searchSchema = z.object({
  name: z.string().trim().min(1, "缺少 name 参数").max(100),
  source: z.string().max(30).optional(),
  count: z.string().optional().transform((val) => (val ? parseInt(val, 10) : env.DEFAULT_SEARCH_COUNT)),
  pages: z.string().optional(),
  page: z.string().optional(),
});

const picSchema = z.object({
  id: z.string().trim().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
  size: z.string().optional().transform((val) => (val ? parseInt(val, 10) : env.DEFAULT_PICTURE_SIZE)),
});

const lyricSchema = z.object({
  id: z.string().trim().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
});

// 跨平台歌曲搜索 (/search)
resourceRoute.get("/search", async (c) => {
  const parsed = parseQuery(c, searchSchema);
  if (parsed.err) return parsed.err;
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
  const parsed = parseQuery(c, picSchema);
  if (parsed.err) return parsed.err;
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
  const parsed = parseQuery(c, lyricSchema);
  if (parsed.err) return parsed.err;
  const { id, source } = parsed.data;
  try {
    const data = await gdStudio.getLyric(id, source || env.DEFAULT_SEARCH_SOURCE);
    return c.json<ApiResponse<LyricResult>>(successResponse(data));
  } catch (error: any) {
    console.error(`[Lyric Error] id=${id}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取歌词失败: ${error.message}`), 500);
  }
});

// 歌单详情与完整歌曲列表获取 (/playlist/:id)
resourceRoute.get("/playlist/:id", async (c) => {
  const playlistParam = c.req.param("id")?.trim();
  if (!playlistParam) {
    return c.json<ApiResponse>(errorResponse(400, "无效的歌单 ID"), 400);
  }

  const query = c.req.query();
  // limit clamp 到 [1, MAX_LIMIT]：杜绝超大值触发对上游的无界并发批量详情请求
  const rawLimit = query.limit ? parseInt(query.limit, 10) || 1000 : 1000;
  const limit = Math.min(Math.max(rawLimit, 1), PLAYLIST_CONFIG.MAX_LIMIT);
  const idsOnly = query.idsOnly === "true" || query.raw === "true";

  try {
    const detail = await gdStudio.getPlaylistDetail(playlistParam, limit);
    if (!detail || (detail.songIds.length === 0 && detail.tracks.length === 0)) {
      return c.json<ApiResponse>(errorResponse(404, "未找到该歌单或歌单为空"), 404);
    }

    if (idsOnly) {
      return c.json<ApiResponse<string[]>>(successResponse(detail.songIds, "获取歌单歌曲ID成功"));
    }

    return c.json<ApiResponse<PlaylistDetail>>(successResponse(detail, "获取歌单详情成功"));
  } catch (error: any) {
    console.error(`[Playlist Error] id=${playlistParam}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取歌单失败: ${error.message}`), 500);
  }
});

export { resourceRoute };
