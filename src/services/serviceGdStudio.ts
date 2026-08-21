import axios, { type AxiosInstance } from "axios";
import { env, HTTP_CONFIG, AUDIO_CONFIG, UPSTREAM_APIS } from "../config/index.js";
import { globalCache } from "./serviceCache.js";
import { sanitizeParam } from "../utils/utilString.js";
import type {
  GDTrack,
  GDUrlResponse,
  GDPicResponse,
  GDLyricResponse,
  LyricResult,
} from "../types/typeMusic.js";

class GDStudioService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = env.GDSTUDIO_API_URL;
    this.client = axios.create({
      timeout: env.REQUEST_TIMEOUT,
      headers: {
        "User-Agent": HTTP_CONFIG.USER_AGENT,
        Accept: "application/json, text/plain, */*",
      },
    });
  }

  /**
   * 通用调用 GD Studio API 并按策略缓存
   */
  async callApi<T>(types: string, params: Record<string, string | number> = {}, ttl: number = env.CACHE_TTL_AUDIO): Promise<T> {
    const cacheKey = `gd:${types}:${JSON.stringify(params)}`;
    const cached = globalCache.get(cacheKey) as T | null;
    if (cached) {
      return cached;
    }

    const query = new URLSearchParams({
      types,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });

    const requestUrl = `${this.baseUrl}?${query.toString()}`;
    try {
      const response = await this.client.get<T>(requestUrl);
      const data = response.data;
      if (data) {
        globalCache.set(cacheKey, data, ttl);
      }
      return data;
    } catch (error: any) {
      const msg = error.response ? `HTTP ${error.response.status}` : error.message;
      console.error(`[GDStudio] 请求失败 (${types}): ${msg} - URL: ${requestUrl}`);
      throw new Error(`GD Studio API 请求失败: ${msg}`);
    }
  }

  /**
   * 搜索歌曲/专辑
   */
  async search(
    name: string,
    source: string = env.DEFAULT_SEARCH_SOURCE,
    count: number = env.DEFAULT_SEARCH_COUNT,
    pages: number = AUDIO_CONFIG.DEFAULT_SEARCH_PAGE
  ): Promise<GDTrack[]> {
    const cleanName = sanitizeParam(name);
    if (!cleanName) return [];

    const cleanCount = Math.min(Math.max(count || env.DEFAULT_SEARCH_COUNT, 1), AUDIO_CONFIG.MAX_SEARCH_COUNT);
    const cleanPages = Math.max(pages || AUDIO_CONFIG.DEFAULT_SEARCH_PAGE, 1);
    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();

    const data = await this.callApi<GDTrack[]>(
      "search",
      {
        source: cleanSource,
        name: cleanName,
        count: cleanCount,
        pages: cleanPages,
      },
      env.CACHE_TTL_SEARCH
    );

    return Array.isArray(data) ? data : [];
  }

  /**
   * 获取音频播放链接
   */
  async getUrl(
    id: string | number,
    source: string = env.DEFAULT_AUDIO_SOURCE,
    br: number = env.DEFAULT_BITRATE
  ): Promise<GDUrlResponse | null> {
    const cleanId = sanitizeParam(id, 50);
    if (!cleanId) return null;

    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_AUDIO_SOURCE).toLowerCase();
    const cleanBr = (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(Number(br))
      ? Number(br)
      : env.DEFAULT_BITRATE;

    const data = await this.callApi<GDUrlResponse>(
      "url",
      {
        source: cleanSource,
        id: cleanId,
        br: cleanBr,
      },
      env.CACHE_TTL_AUDIO
    );

    if (data && typeof data === "object" && data.url) {
      return {
        url: data.url,
        br: Number(data.br) || cleanBr,
        size: Number(data.size) || 0,
        source: cleanSource,
        from: data.from || "music.gdstudio.xyz",
      };
    }
    return null;
  }

  /**
   * 获取专辑封面
   */
  async getPic(
    id: string | number,
    source: string = env.DEFAULT_SEARCH_SOURCE,
    size: number = env.DEFAULT_PICTURE_SIZE
  ): Promise<GDPicResponse | null> {
    const cleanId = sanitizeParam(id, 100);
    if (!cleanId) return null;

    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();
    const cleanSize = (AUDIO_CONFIG.SUPPORTED_PICTURE_SIZES as readonly number[]).includes(Number(size))
      ? Number(size)
      : env.DEFAULT_PICTURE_SIZE;

    const data = await this.callApi<GDPicResponse>(
      "pic",
      {
        source: cleanSource,
        id: cleanId,
        size: cleanSize,
      },
      env.CACHE_TTL_PICTURE
    );

    if (data && typeof data === "object" && data.url) {
      return { url: data.url, from: data.from };
    }
    return null;
  }

  /**
   * 获取歌词
   */
  async getLyric(
    id: string | number,
    source: string = env.DEFAULT_SEARCH_SOURCE
  ): Promise<LyricResult> {
    const cleanId = sanitizeParam(id, 100);
    if (!cleanId) return { lyric: "", tlyric: "" };

    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();

    const data = await this.callApi<GDLyricResponse>(
      "lyric",
      {
        source: cleanSource,
        id: cleanId,
      },
      env.CACHE_TTL_LYRIC
    );

    if (data && typeof data === "object") {
      return {
        lyric: data.lyric || "",
        tlyric: data.tlyric || "",
      };
    }
    return { lyric: "", tlyric: "" };
  }

  /**
   * 获取网易云歌单或专辑的歌曲 ID 列表
   */
  async getPlaylistSongIds(playlistId: string | number): Promise<string[]> {
    const cleanId = sanitizeParam(playlistId, 50);
    if (!cleanId) return [];

    const cacheKey = `playlist:ids:${cleanId}`;
    const cached = globalCache.get(cacheKey) as string[] | null;
    if (cached) return cached;

    // 1. 优先尝试网易云官方歌单接口
    try {
      const ncmUrl = `${UPSTREAM_APIS.NETEASE_PLAYLIST_DETAIL}?id=${encodeURIComponent(cleanId)}`;
      const res = await this.client.get<{
        playlist?: {
          trackIds?: Array<{ id: number | string }>;
          tracks?: Array<{ id: number | string }>;
        };
      }>(ncmUrl, {
        headers: {
          Referer: UPSTREAM_APIS.NETEASE_REFERER,
          "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
        },
        timeout: 8000,
      });

      const playlist = res.data && res.data.playlist;
      const trackList = playlist?.trackIds || playlist?.tracks;
      if (Array.isArray(trackList) && trackList.length > 0) {
        const ids = trackList.map((t) => String(t.id)).filter(Boolean);
        globalCache.set(cacheKey, ids, env.CACHE_TTL_PLAYLIST);
        return ids;
      }
    } catch (err: any) {
      console.warn(`[Playlist] 网易云官方歌单拉取失败: ${err.message}，尝试专辑接口回退...`);
    }

    // 2. 回退尝试 GD Studio netease_album
    try {
      const albumData = await this.callApi<GDTrack[]>(
        "search",
        {
          source: "netease_album",
          name: cleanId,
        },
        env.CACHE_TTL_PLAYLIST
      );
      if (Array.isArray(albumData) && albumData.length > 0) {
        const ids = albumData.map((song) => String(song.id)).filter(Boolean);
        if (ids.length > 0) {
          globalCache.set(cacheKey, ids, env.CACHE_TTL_PLAYLIST);
          return ids;
        }
      }
    } catch (err: any) {
      console.warn(`[Playlist] GD Studio netease_album 获取失败: ${err.message}`);
    }

    return [];
  }
}

export const gdStudio = new GDStudioService();
export const gdstudio = gdStudio;
