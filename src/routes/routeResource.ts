import { Hono, type Context } from "hono";
import { z } from "zod";
import { env, AUDIO_CONFIG } from "../config/index.js";
import { gdStudio } from "../services/serviceGdStudio.js";
import { successResponse, errorResponse } from "../utils/utilResponse.js";
import { sanitizeLogParam } from "../utils/utilString.js";
import type { ApiResponse, AppEnv } from "../types/typeApi.js";
import type { GDTrack, GDPicResponse, LyricResult, PlaylistDetail } from "../types/typeMusic.js";

const resourceRoute = new Hono<AppEnv>();

/** 上游明确拒绝的 source 属客户端参数错误，返回 400 而非 500 */
function unsupportedSourceResponse(c: Context, error: any) {
  if (error?.message?.startsWith("不支持的上游音源")) {
    return c.json<ApiResponse>(errorResponse(400, error.message), 400);
  }
  return null;
}


const searchSchema = z.object({
  name: z.string().min(1, "缺少 name 参数").max(100),
  source: z.string().max(30).optional(),
  count: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? "", 10);
      return Number.isInteger(n) ? n : env.DEFAULT_SEARCH_COUNT;
    }),
  pages: z.string().optional(),
  page: z.string().optional(),
});

const picSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
  size: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? "", 10);
      return Number.isInteger(n) ? n : env.DEFAULT_PICTURE_SIZE;
    }),
});

const lyricSchema = z.object({
  id: z.string().min(1, "缺少 id 参数").max(100),
  source: z.string().max(30).optional(),
  // 歌词兜底用元数据（可选）：上游无歌词时走 lrclib.net 按曲名/歌手/时长匹配
  name: z.string().max(100).optional(),
  artist: z.string().max(100).optional(),
  album: z.string().max(100).optional(),
  duration: z.string().max(20).optional(),
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
    const bad = unsupportedSourceResponse(c, error);
    if (bad) return bad;
    console.error(`[Search Error] name=${sanitizeLogParam(name)}:`, error.message);
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
    const bad = unsupportedSourceResponse(c, error);
    if (bad) return bad;
    console.error(`[Picture Error] id=${sanitizeLogParam(id)}:`, error.message);
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

  const { id, source, name, artist, album, duration } = parsed.data;
  try {
    const data = await gdStudio.getLyric(id, source || env.DEFAULT_SEARCH_SOURCE, {
      track_name: name,
      artist_name: artist,
      album_name: album,
      duration: duration ? Number(duration) : undefined,
    });
    return c.json<ApiResponse<LyricResult>>(successResponse(data));
  } catch (error: any) {
    const bad = unsupportedSourceResponse(c, error);
    if (bad) return bad;
    console.error(`[Lyric Error] id=${sanitizeLogParam(id)}:`, error.message);
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
  const limitRaw = parseInt(query.limit ?? "", 10);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, AUDIO_CONFIG.MAX_PLAYLIST_LIMIT)
      : AUDIO_CONFIG.DEFAULT_PLAYLIST_LIMIT;
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
    console.error(`[Playlist Error] id=${sanitizeLogParam(playlistParam)}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取歌单失败: ${error.message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// 服务端媒体中转 (/relay?url=<encoded>)
//
// 背景：部分用户网络整段阻断音乐 CDN 域名（Joox/网易云等，浏览器侧
// ERR_CONNECTION_CLOSED），直链注定失败。本端点由服务端代取字节流后转交
// 浏览器：浏览器只连接本站域名即可播放/加载封面。
//
// SSRF 防护（Ultracode 审查红线，本端点是唯一的"用户指定 URL"出口）：
//   1. 仅允许 http/https 协议；
//   2. 主机名必须命中 RELAY_HOST_SUFFIXES 白名单（精确或子域后缀匹配）；
//   3. 禁止 URL 内嵌 userinfo 凭证；
//   4. 重定向手动跟随、逐跳重新校验白名单，最多 3 跳；
//   5. 单跳 20s 超时；总大小上限 150MB（覆盖 FLAC），超限即断流；
//   6. 只向上游发送 Range + 通用 UA，不转发 Cookie/Authorization/Origin；
//   7. 只向客户端透传安全的响应头子集（content-type/range/length 等）。
// ---------------------------------------------------------------------------
const relaySchema = z.object({
  url: z.string().min(1, "缺少 url 参数").max(2000, "url 参数过长"),
});

/** 允许中转的媒体 CDN 主机后缀（精确匹配或子域后缀匹配） */
const RELAY_HOST_SUFFIXES = [
  "music.126.net",
  "joox.com",
  "qqmusic.qq.com",
  // F-005：bilibili / bilivideo 音源返回的媒体 URL  host 为 upos-*.bilivideo.com，
  // 不加会导致 /relay 对这批用户静默失效（功能缺口，非安全弱点）
  "bilivideo.com",
] as const;
const RELAY_TIMEOUT_MS = 20000;
const RELAY_MAX_BYTES = 150 * 1024 * 1024;
const RELAY_MAX_REDIRECTS = 3;
const RELAY_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** 透传给客户端的安全响应头白名单 */
const RELAY_PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
] as const;

function isRelayHostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return RELAY_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** 校验并解析中转目标；不合法返回 null（调用方统一 400） */
function parseRelayTarget(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!isRelayHostAllowed(u.hostname)) return null;
  return u;
}

resourceRoute.get("/relay", async (c) => {
  const parsed = relaySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json<ApiResponse>(
      errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"),
      400
    );
  }
  const first = parseRelayTarget(parsed.data.url);
  if (!first) {
    return c.json<ApiResponse>(errorResponse(400, "url 非法或不在媒体 CDN 白名单内"), 400);
  }

  const rangeHeader = c.req.header("range");
  const upstreamHeaders: Record<string, string> = {
    // 不发送 Referer/Origin：部分 CDN（如 Bilibili upos）会按 Referer 拒绝，
    // 无 Referer 与前端 referrerpolicy="no-referrer" 行为一致
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "*/*",
  };
  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  try {
    let current: URL = first;
    let upstream: Response | null = null;
    for (let hop = 0; hop <= RELAY_MAX_REDIRECTS; hop++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RELAY_TIMEOUT_MS);
      try {
        upstream = await fetch(current, {
          method: "GET",
          headers: upstreamHeaders,
          redirect: "manual",
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (upstream && RELAY_REDIRECT_STATUSES.has(upstream.status)) {
        const loc = upstream.headers.get("location");
        await upstream.body?.cancel().catch(() => {});
        upstream = null;
        if (!loc) break;
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          break;
        }
        const validated = parseRelayTarget(next.toString());
        if (!validated) break; // 跳出白名单的重定向一律拒绝
        current = validated;
        continue;
      }
      break;
    }

    if (!upstream || !upstream.ok || !upstream.body) {
      await upstream?.body?.cancel().catch(() => {});
      return c.json<ApiResponse>(errorResponse(502, "上游媒体服务不可用"), 502);
    }

    const declared = upstream.headers.get("content-length");
    if (declared && Number(declared) > RELAY_MAX_BYTES) {
      await upstream.body.cancel().catch(() => {});
      return c.json<ApiResponse>(errorResponse(502, "上游媒体文件过大，拒绝中转"), 502);
    }

    const outHeaders = new Headers();
    for (const k of RELAY_PASS_HEADERS) {
      const v = upstream.headers.get(k);
      if (v) outHeaders.set(k, v);
    }

    // 边读边限大小：防止 content-length 缺失/撒谎时的无限流
    let seen = 0;
    const limited = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > RELAY_MAX_BYTES) {
            controller.error(new Error("RELAY_TOO_LARGE"));
            return;
          }
          controller.enqueue(chunk);
        },
      })
    );

    // 透传上游状态码：206（Range 分片）对 <audio> 进度拖拽至关重要
    return new Response(limited, { status: upstream.status, headers: outHeaders });
  } catch (error: any) {
    const msg =
      error?.name === "AbortError" ? "上游媒体服务响应超时" : "中转请求失败";
    console.error(`[Relay Error] url=${sanitizeLogParam(parsed.data.url.slice(0, 80))}:`, error?.message);
    return c.json<ApiResponse>(errorResponse(502, msg), 502);
  }
});

export { resourceRoute };
