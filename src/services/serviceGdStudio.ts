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
  PlaylistDetail,
  PlaylistTrack,
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
   * 获取歌词（尽力而为：上游失败自动重试一次，仍失败则返回空歌词而非抛错，
   * 歌词属可选增强数据，不应让播放主链路出现 500 噪音）
   */
  async getLyric(
    id: string | number,
    source: string = env.DEFAULT_SEARCH_SOURCE
  ): Promise<LyricResult> {
    const cleanId = sanitizeParam(id, 100);
    if (!cleanId) return { lyric: "", tlyric: "" };

    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();

    const fetchOnce = () =>
      this.callApi<GDLyricResponse>(
        "lyric",
        {
          source: cleanSource,
          id: cleanId,
        },
        env.CACHE_TTL_LYRIC
      );

    let data: GDLyricResponse | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        data = await fetchOnce();
        break;
      } catch (error: any) {
        if (attempt === 0) {
          console.warn(`[GDStudio] 歌词获取失败，重试一次 (id=${cleanId}): ${error.message}`);
          continue;
        }
        console.error(`[GDStudio] 歌词获取最终失败 (id=${cleanId}): ${error.message}，降级为空歌词`);
      }
    }

    if (data && typeof data === "object") {
      return {
        lyric: data.lyric || "",
        tlyric: data.tlyric || "",
      };
    }
    return { lyric: "", tlyric: "" };
  }

  /**
   * 获取网易云歌单详情与完整歌曲元数据列表（支持分块并发全部解析）
   */
  async getPlaylistDetail(playlistId: string | number, limit: number = 1000): Promise<PlaylistDetail | null> {
    const rawId = String(playlistId || "").trim();
    const match = rawId.match(/id=(\d+)/) || rawId.match(/^(\d+)$/);
    const cleanId = sanitizeParam(match ? match[1] : rawId, 50);
    if (!cleanId) return null;

    const cacheKey = `playlist:detail:${cleanId}:${limit}`;
    const cached = globalCache.get(cacheKey) as PlaylistDetail | null;
    if (cached) return cached;

    // 1. 优先尝试网易云官方歌单接口
    try {
      const ncmUrl = `${UPSTREAM_APIS.NETEASE_PLAYLIST_DETAIL}?id=${encodeURIComponent(cleanId)}`;
      const res = await this.client.get<{
        playlist?: {
          id?: number | string;
          name?: string;
          coverImgUrl?: string;
          description?: string;
          trackCount?: number;
          creator?: {
            nickname?: string;
          };
          trackIds?: Array<{ id: number | string }>;
          tracks?: Array<any>;
        };
      }>(ncmUrl, {
        headers: {
          Referer: UPSTREAM_APIS.NETEASE_REFERER,
          "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
        },
        timeout: 8000,
      });

      const playlist = res.data && res.data.playlist;
      if (playlist) {
        const rawSongIds = (playlist.trackIds || playlist.tracks || []).map((t) => String(t.id)).filter(Boolean);
        let tracks: PlaylistTrack[] = [];

        if (Array.isArray(playlist.tracks) && playlist.tracks.length > 0) {
          tracks = playlist.tracks.slice(0, limit).map((t: any) => ({
            id: String(t.id),
            name: t.name || "未知曲目",
            artist: (t.ar || t.artists || []).map((a: any) => a.name).join(" / ") || "未知歌手",
            album: t.al?.name || t.album?.name || "未知专辑",
            picUrl: t.al?.picUrl || t.album?.picUrl || "",
            duration: t.dt ? Math.round(t.dt / 1000) : 0,
          }));
        }

        // 如果 tracks 数量少于 limit 且还有更多 trackIds，按 200 个一组批量拉取全部详情
        if (tracks.length < limit && rawSongIds.length > tracks.length) {
          const neededIds = rawSongIds.slice(tracks.length, limit);
          const chunkSize = 200;
          for (let i = 0; i < neededIds.length; i += chunkSize) {
            const chunk = neededIds.slice(i, i + chunkSize);
            try {
              const batchUrl = `https://music.163.com/api/song/detail?ids=[${chunk.join(",")}]`;
              const batchRes = await this.client.get<{ songs?: Array<any> }>(batchUrl, {
                headers: {
                  Referer: UPSTREAM_APIS.NETEASE_REFERER,
                  "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
                },
                timeout: 8000,
              });
              if (Array.isArray(batchRes.data?.songs)) {
                const moreTracks = batchRes.data.songs.map((s: any) => ({
                  id: String(s.id),
                  name: s.name || "未知曲目",
                  artist: (s.artists || []).map((a: any) => a.name).join(" / ") || "未知歌手",
                  album: s.album?.name || "未知专辑",
                  picUrl: s.album?.picUrl || "",
                  duration: s.duration ? Math.round(s.duration / 1000) : 0,
                }));
                tracks.push(...moreTracks);
              }
            } catch (batchErr: any) {
              console.warn(`[Playlist] 批量获取歌曲详情 chunk 异常: ${batchErr.message}`);
            }
          }

          // 补充占位对象以保证总数与原歌单一致
          if (tracks.length < neededIds.length) {
            const existingIdSet = new Set(tracks.map(t => t.id));
            for (const id of rawSongIds.slice(0, limit)) {
              if (!existingIdSet.has(id)) {
                tracks.push({
                  id: String(id),
                  name: `歌单曲目 #${id}`,
                  artist: "网易云音乐",
                  album: playlist.name || "精选歌单",
                  picUrl: "",
                  duration: 0,
                });
              }
            }
          }
        }

        const result: PlaylistDetail = {
          id: cleanId,
          name: playlist.name || `歌单 #${cleanId}`,
          coverImgUrl: playlist.coverImgUrl || "",
          description: playlist.description || "",
          creator: playlist.creator?.nickname || "网易云音乐",
          trackCount: playlist.trackCount || rawSongIds.length,
          tracks,
          songIds: rawSongIds,
        };

        globalCache.set(cacheKey, result, env.CACHE_TTL_PLAYLIST);
        return result;
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
        const tracks: PlaylistTrack[] = albumData.slice(0, limit).map((s) => ({
          id: String(s.id),
          name: s.name || "未知曲目",
          artist: Array.isArray(s.artist) ? s.artist.join(" / ") : (s.artist || "未知歌手"),
          album: s.album || "专辑",
          picUrl: "",
          duration: 0,
        }));
        const songIds = albumData.map((song) => String(song.id)).filter(Boolean);
        const result: PlaylistDetail = {
          id: cleanId,
          name: `专辑 #${cleanId}`,
          coverImgUrl: "",
          description: "由 GD Studio 引擎解析",
          creator: "GDStudio",
          trackCount: albumData.length,
          tracks,
          songIds,
        };
        globalCache.set(cacheKey, result, env.CACHE_TTL_PLAYLIST);
        return result;
      }
    } catch (err: any) {
      console.warn(`[Playlist] GD Studio netease_album 获取失败: ${err.message}`);
    }

    return null;
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
