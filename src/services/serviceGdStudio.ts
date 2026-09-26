import axios, { type AxiosInstance } from "axios";
import { env, HTTP_CONFIG, AUDIO_CONFIG, UPSTREAM_APIS, CACHE_POLICY } from "../config/index.js";
import { globalCache } from "./serviceCache.js";
import { sanitizeParam } from "../utils/utilString.js";
import type {
  GDTrack,
  GDUrlResponse,
  GDUrlStatus,
  GDPicResponse,
  GDLyricResponse,
  LyricResult,
  PlaylistDetail,
  PlaylistTrack,
} from "../types/typeMusic.js";

/**
 * CRC32 (IEEE 802.3, 多项式 0xEDB88320)。
 * GD Studio 官方站同源 api.php 强制签名 s=crc32(urlEncode(name或id))，
 * 缺/错 s 返回 {"detail":"Invalid request."}；公共 music-api.gdstudio.xyz
 * 目前无签也能调通，但为与官方实现对齐、防范未来收紧，统一加签。
 */
const CRC32_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** GD 官方 urlEncode：encodeURIComponent 后再转义 ()*'! */
function gdUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

class GDStudioService {
  private client: AxiosInstance;
  private baseUrl: string;

  /**
   * 各端点实测支持的 source 白名单（GD Studio api.php 实测矩阵）。
   * 用黑名单会漏网：如 /pic?source=bilibili 不在黑名单内，会透传上游拿 400，
   * 再被路由层误包装成 500。白名单让非法组合在入口即抛错，路由层映射为 400。
   */
  private static readonly SUPPORTED_SOURCES_BY_ENDPOINT: Record<string, Set<string>> = {
    search: new Set(["netease", "joox", "bilibili", "netease_album"]),
    url: new Set(["netease", "joox", "bilibili"]),
    lyric: new Set(["netease", "joox"]),
    pic: new Set(["netease", "joox"]),
  };

  private assertSourceSupported(source: string, endpoint: string): void {
    const allowed = GDStudioService.SUPPORTED_SOURCES_BY_ENDPOINT[endpoint];
    if (!allowed || !allowed.has(source)) {
      throw new Error(`不支持的上游音源: ${source}（端点 ${endpoint} 不支持该 source）`);
    }
  }

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
    // 缓存键归一化：键名排序后序列化，避免相同语义参数因键序不同导致缓存穿透
    const stableParams = Object.keys(params)
      .sort()
      .map((k) => [k, (params as Record<string, any>)[k]] as const);
    const cacheKey = `gd:${types}:${JSON.stringify(stableParams)}`;
    const cached = globalCache.get(cacheKey) as T | null;
    if (cached) {
      return cached;
    }

    // single-flight：同一参数的并发上游请求共享一次，避免缓存击穿时的雷鸣群
    return globalCache.getOrFetch(cacheKey, async (): Promise<T> => {
    const query = new URLSearchParams({
      types,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });

    // GD 官方签名：search 签 name，url/lyric/pic 签 id，其他 types 若带 id 则签 id。
    // s=crc32(urlEncode(签名对象))，十进制字符串形式加入 query。
    // ⚠️ 安全声明：此签名仅为上游 GD Studio 协议要求的字段，CRC32 无密钥、
    // 完全可预测、可重放，不构成任何安全边界。绝不能将其用作鉴权、防重放或
    // 防篡改依据——任何需要安全性的场景必须另行设计密钥机制。
    const signTarget =
      types === "search"
        ? params["name"]
        : params["id"] !== undefined
          ? params["id"]
          : undefined;
    if (signTarget !== undefined && signTarget !== "") {
      query.set("s", String(crc32(gdUrlEncode(String(signTarget)))));
    }

    const requestUrl = `${this.baseUrl}?${query.toString()}`;
    try {
      const response = await this.client.get<T>(requestUrl);
      const data = response.data;
      if (data) {
        globalCache.set(cacheKey, data, ttl);
      }
      return data;
    } catch (error: any) {
      const status = error.response?.status as number | undefined;
      const msg = status ? `HTTP ${status}` : error.message;
      console.error(`[GDStudio] 请求失败 (${types}): ${msg} - URL: ${requestUrl}`);
      const wrapped = new Error(`GD Studio API 请求失败: ${msg}`);
      // 把上游状态码带在错误对象上，供调用方区分错误类型：
      // 4xx 为确定性失败不应重试，网络错误/超时/5xx 才值得重试
      (wrapped as any).upstreamStatus = status;
      throw wrapped;
    }
    });
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
    // pages 必须有上界：无上界时会原样透传上游，且每个不同值独占缓存键，可被用来 churn LRU
    const cleanPages = Math.min(Math.max(pages || AUDIO_CONFIG.DEFAULT_SEARCH_PAGE, 1), AUDIO_CONFIG.MAX_SEARCH_PAGES);
    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();
    this.assertSourceSupported(cleanSource, "search");

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
    this.assertSourceSupported(cleanSource, "url");
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

    // 上游 br 负值语义：-1 获取失败 / -2 无版权 / -3 试听版。
    // 软失败时保持返回对象（含空 url）而非 null，由调用方按 status 决定是否换源。
    const rawBr = Number((data as any)?.br);
    const hasUrl = Boolean(data && typeof data === "object" && (data as any).url);
    const status: GDUrlStatus =
      hasUrl
        ? "ok"
        : rawBr === -2
          ? "no_copyright"
          : rawBr === -3
            ? "trial"
            : "unavailable";
    // 上游 api.php 返回的 br 单位是 kbps（如 320）；本项目与
    // @unblockneteasemusic/server 0.28.0 对齐，对外统一使用 bps（如 320000）
    const brKbps = rawBr > 0 ? rawBr : cleanBr;
    return {
      url: hasUrl ? String((data as any).url) : "",
      br: brKbps * 1000,
      size: Number((data as any)?.size) || 0,
      source: cleanSource,
      from: (data as any)?.from || "music.gdstudio.xyz",
      status,
    };
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
    this.assertSourceSupported(cleanSource, "pic");
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
   *
   * 兜底链：GD 上游 lyric → lrclib.net（需 meta.track_name）。
   * lrclib 超时 8s，失败静默降级为空，不阻断主链路。
   */
  async getLyric(
    id: string | number,
    source: string = env.DEFAULT_SEARCH_SOURCE,
    meta?: {
      artist_name?: string;
      track_name?: string;
      album_name?: string;
      duration?: number;
    }
  ): Promise<LyricResult> {
    const cleanId = sanitizeParam(id, 100);
    if (!cleanId) return { lyric: "", tlyric: "" };

    const cleanSource = sanitizeParam(source, 30, env.DEFAULT_SEARCH_SOURCE).toLowerCase();
    this.assertSourceSupported(cleanSource, "lyric");

    // 歌词结果级缓存（含负缓存）：上游无歌词的歌曲每次请求会打满 2 次 GD + 1 次 lrclib，
    // 空结果与兜底结果只缓存短 TTL，既抑制重复上游消耗又避免长期锁定
    const resultKey = `lyric:result:${cleanSource}:${cleanId}`;
    const cachedResult = globalCache.get(resultKey) as LyricResult | null;
    if (cachedResult) return cachedResult;
    const cacheResult = (result: LyricResult, ttl: number): LyricResult => {
      globalCache.set(resultKey, result, ttl);
      return result;
    };

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
        const status = (error as any)?.upstreamStatus as number | undefined;
        // 4xx 为确定性失败（参数非法/无权限/不存在），重试多少次结果都一样，直接降级
        if (status !== undefined && status >= 400 && status < 500) {
          console.warn(`[GDStudio] 歌词请求被上游拒绝 (HTTP ${status}, id=${cleanId})，不再重试`);
          break;
        }
        if (attempt === 0) {
          console.warn(`[GDStudio] 歌词获取失败，重试一次 (id=${cleanId}): ${error.message}`);
          // 重试前退避 300ms，避免对抖动中的上游造成突发压力
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        console.error(`[GDStudio] 歌词获取最终失败 (id=${cleanId}): ${error.message}，降级为空歌词`);
      }
    }

    if (data && typeof data === "object" && (data.lyric || data.tlyric)) {
      return cacheResult(
        {
          lyric: data.lyric || "",
          tlyric: data.tlyric || "",
        },
        env.CACHE_TTL_LYRIC
      );
    }

    // 上游无歌词时走 lrclib.net 兜底（与 GD 官方站行为对齐）
    const trackName = meta?.track_name?.trim();
    if (trackName) {
      try {
        const lrclib = axios.create({ timeout: 8000 });
        // lrclib duration 单位为秒；NCM 系 duration 多为毫秒，>10000 时换算
        const rawDur = Number(meta?.duration) || 0;
        const durSec = rawDur > 10000 ? Math.round(rawDur / 1000) : Math.round(rawDur);
        const q = new URLSearchParams();
        if (meta?.artist_name?.trim()) q.set("artist_name", meta.artist_name.trim());
        q.set("track_name", trackName);
        if (meta?.album_name?.trim()) q.set("album_name", meta.album_name.trim());
        if (durSec > 0) q.set("duration", String(durSec));
        const res = await lrclib.get<{
          syncedLyrics?: string;
          plainLyrics?: string;
        }>(`https://lrclib.net/api/get?${q.toString()}`, {
          headers: { "User-Agent": HTTP_CONFIG.USER_AGENT },
        });
        const synced = res.data?.syncedLyrics?.trim();
        if (synced) {
          return cacheResult({ lyric: synced, tlyric: "" }, CACHE_POLICY.TTL_LYRIC_NEGATIVE);
        }
      } catch (err: any) {
        console.warn(`[GDStudio] lrclib 兜底失败 (track=${trackName}): ${err.message}`);
      }
    }

    return cacheResult({ lyric: "", tlyric: "" }, CACHE_POLICY.TTL_LYRIC_NEGATIVE);
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
        // 受限并发（3路）+ allSettled：避免单请求串行放大为数十次上游调用
        if (tracks.length < limit && rawSongIds.length > tracks.length) {
          const neededIds = rawSongIds.slice(tracks.length, limit);
          const chunkSize = 200;
          const chunks: string[][] = [];
          for (let i = 0; i < neededIds.length; i += chunkSize) {
            chunks.push(neededIds.slice(i, i + chunkSize));
          }
          const CONCURRENCY = 3;
          const fetchChunk = async (chunk: string[]) => {
            try {
              const batchUrl = `${UPSTREAM_APIS.NETEASE_SONG_DETAIL_BATCH}?ids=[${chunk.join(",")}]`;
              const batchRes = await this.client.get<{ songs?: Array<any> }>(batchUrl, {
                headers: {
                  Referer: UPSTREAM_APIS.NETEASE_REFERER,
                  "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
                },
                timeout: 8000,
              });
              if (Array.isArray(batchRes.data?.songs)) {
                return batchRes.data.songs.map((s: any) => ({
                  id: String(s.id),
                  name: s.name || "未知曲目",
                  artist: (s.artists || []).map((a: any) => a.name).join(" / ") || "未知歌手",
                  album: s.album?.name || "未知专辑",
                  picUrl: s.album?.picUrl || "",
                  duration: s.duration ? Math.round(s.duration / 1000) : 0,
                }));
              }
            } catch (batchErr: any) {
              console.warn(`[Playlist] 批量获取歌曲详情 chunk 异常: ${batchErr.message}`);
            }
            return [];
          };
          for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(batch.map(fetchChunk));
            for (const r of results) {
              if (r.status === "fulfilled") tracks.push(...r.value);
            }
          }

          // 只保留**真实取到元数据**的曲目，不再合成占位对象。
          // 原实现在缺失时填充 "歌单曲目 #id" / artist="网易云音乐" / duration=0，
          // 其形状与真实条目一致，消费端无法区分成功与降级，等于把降级结果伪装成成功。
          // 改为如实返回已获取到的曲目，并通过 missingCount 显式声明缺失数量。
          const __missingInBatch = Math.max(0, neededIds.length - tracks.length);
          if (__missingInBatch > 0) {
            console.warn(`[Playlist] 歌单 ${cleanId} 批量详情有 ${__missingInBatch} 首曲目元数据缺失`);
          }
        }

        // 相对请求 limit 的缺失数（如实声明，不再用占位对象伪装）
        const missingCount = Math.max(0, Math.min(rawSongIds.length, limit) - tracks.length);

        const result: PlaylistDetail = {
          id: cleanId,
          name: playlist.name || `歌单 #${cleanId}`,
          coverImgUrl: playlist.coverImgUrl || "",
          description: playlist.description || "",
          creator: playlist.creator?.nickname || "网易云音乐",
          trackCount: playlist.trackCount || rawSongIds.length,
          tracks,
          songIds: rawSongIds,
          partialLoaded: missingCount > 0 ? missingCount : undefined,
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
}

export const gdStudio = new GDStudioService();
