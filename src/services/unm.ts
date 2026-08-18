import { createRequire } from "node:module";
import axios from "axios";
import {
  env,
  AUDIO_CONFIG,
  PROVIDER_CONFIG,
  UPSTREAM_APIS,
  HTTP_CONFIG,
} from "../config/index.js";
import { globalCache } from "./cache.js";
import { gdstudio } from "./gdstudio.js";
import { sanitizeParam, formatProxyUrl } from "../utils/string.js";
import type { SongDetail, MatchedAudio, NcmAudioResult } from "../types/music.js";

const require = createRequire(import.meta.url);
const unmConsts = require("@unblockneteasemusic/server/src/consts");
const unmMatch = require("@unblockneteasemusic/server");

/**
 * 获取所有支持的音源列表（与 @unblockneteasemusic/server 最新版 0.28.0 完全对齐）
 */
export function getAvailableProviders(): string[] {
  const providers = Object.keys(unmConsts.PROVIDERS || {});
  if (!providers.includes("gdstudio")) {
    providers.unshift("gdstudio");
  }
  return providers;
}

/**
 * 动态修复与注入 UNM Provider 体系（兼容 0.28.0+ 最新版）
 */
export function setupUnmProviders(): void {
  // 1. 注入 gdstudio Provider
  unmConsts.PROVIDERS.gdstudio = {
    async check(info: any) {
      try {
        const keyword = `${info.name || ""} ${info.artists?.[0]?.name || ""}`.trim();
        if (!keyword) return null;
        const list = await gdstudio.search(keyword, env.DEFAULT_AUDIO_SOURCE, 5, 1);
        if (!Array.isArray(list) || list.length === 0) return null;

        const target = list.find((item) => item.name === info.name) || list[0];
        const audio = await gdstudio.getUrl(target.id, env.DEFAULT_AUDIO_SOURCE, env.DEFAULT_BITRATE);
        return audio?.url || null;
      } catch {
        return null;
      }
    },
  };

  // 2. 修复/增强 pyncmd Provider（对接到最新 GD Studio 引擎）
  unmConsts.PROVIDERS.pyncmd = {
    async check(info: any) {
      try {
        const audio = await gdstudio.getUrl(info.id, env.DEFAULT_SEARCH_SOURCE, env.DEFAULT_BITRATE);
        if (audio && audio.url) {
          return audio.url;
        }
        return await unmConsts.PROVIDERS.gdstudio.check(info);
      } catch {
        return null;
      }
    },
  };

  // 3. 修复/增强 joox Provider（免自备 Cookie 解析）
  unmConsts.PROVIDERS.joox = {
    async check(info: any) {
      return await unmConsts.PROVIDERS.gdstudio.check(info);
    },
  };

  // 4. 更新默认音源列表优先级
  const prioritySources = [...PROVIDER_CONFIG.DEFAULT_PRIORITY_LIST];
  const finalSources = [
    ...prioritySources,
    ...Object.keys(unmConsts.PROVIDERS).filter((p) => !prioritySources.includes(p as any)),
  ];

  unmConsts.DEFAULT_SOURCE.length = 0;
  unmConsts.DEFAULT_SOURCE.push(...finalSources);
  console.log(`[UNM Engine 0.28.0+] 适配完成，总支持音源数: ${Object.keys(unmConsts.PROVIDERS).length}，默认优先顺序: ${unmConsts.DEFAULT_SOURCE.slice(0, 6).join(", ")}...`);
}

// 自动初始化 Provider
setupUnmProviders();

/**
 * 获取网易云官方歌曲元数据
 */
export async function getNeteaseSongDetail(id: string | number): Promise<SongDetail | null> {
  const cleanId = sanitizeParam(id, 50);
  if (!cleanId) return null;

  const cacheKey = `ncm:detail:${cleanId}`;
  const cached = globalCache.get(cacheKey) as SongDetail | null;
  if (cached) return cached;

  try {
    const res = await axios.get(`${UPSTREAM_APIS.NETEASE_SONG_DETAIL}?ids=[${encodeURIComponent(cleanId)}]`, {
      timeout: 6000,
      headers: {
        Referer: UPSTREAM_APIS.NETEASE_REFERER,
        "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
      },
    });
    const song = res.data?.songs?.[0];
    if (song) {
      const detail: SongDetail = {
        id: String(song.id),
        name: song.name || "",
        artist: (song.artists || []).map((a: any) => a.name).join(" / "),
        album: song.album?.name || "",
        picUrl: song.album?.picUrl || "",
        duration: song.duration || 0,
      };
      globalCache.set(cacheKey, detail, env.CACHE_TTL_SONG_DETAIL);
      return detail;
    }
  } catch (err: any) {
    console.warn(`[NCM Detail] 获取歌曲 ${cleanId} 元数据失败: ${err.message}`);
  }
  return null;
}

/**
 * 核心歌曲匹配与解灰
 */
export async function matchSong(
  id: string | number,
  servers?: string[] | null,
  br: number | string = env.DEFAULT_BITRATE
): Promise<MatchedAudio> {
  const cleanId = sanitizeParam(id, 50);
  if (!cleanId) {
    throw new Error("缺少歌曲 ID 参数");
  }

  const cleanBr = (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(Number(br))
    ? Number(br)
    : env.DEFAULT_BITRATE;

  const serverList = Array.isArray(servers) && servers.length > 0
    ? servers
    : env.DEFAULT_MATCH_SERVERS.split(",").map((s) => s.trim()).filter(Boolean);

  const cacheKey = `match:${cleanId}:${serverList.join(",")}:${cleanBr}`;
  const cached = globalCache.get(cacheKey) as MatchedAudio | null;
  if (cached) {
    return cached;
  }

  // 1. 获取网易云元数据
  const detail = await getNeteaseSongDetail(cleanId);

  // 2. 尝试使用 UNM 引擎进行多源匹配
  let matchResult: { url?: string; br?: number; size?: number; source?: string; md5?: string | null } | null = null;
  try {
    matchResult = await unmMatch(cleanId, serverList);
  } catch {
    console.warn(`[UNM Match] UNM 引擎直接匹配未命中 (${cleanId})，启动备选智能降级...`);
  }

  // 3. 若 UNM 未能返回 URL，使用 GD Studio 智能检索降级
  if (!matchResult || !matchResult.url) {
    if (detail && detail.name) {
      const keyword = `${detail.name} ${detail.artist}`.trim();
      const gdList = await gdstudio.search(keyword, env.DEFAULT_AUDIO_SOURCE, 5, 1);
      if (Array.isArray(gdList) && gdList.length > 0) {
        const topTrack = gdList.find((t) => t.name === detail.name) || gdList[0];
        const audio = await gdstudio.getUrl(topTrack.id, env.DEFAULT_AUDIO_SOURCE, cleanBr);
        if (audio && audio.url) {
          matchResult = {
            url: audio.url,
            br: audio.br || cleanBr * 1000,
            size: audio.size || 0,
            source: env.DEFAULT_AUDIO_SOURCE,
            md5: null,
          };
        }
      }
    }
  }

  // 4. 再次降级：直接尝试 GD Studio 的 netease 源
  if (!matchResult || !matchResult.url) {
    const directNetease = await gdstudio.getUrl(cleanId, env.DEFAULT_SEARCH_SOURCE, cleanBr);
    if (directNetease && directNetease.url) {
      matchResult = {
        url: directNetease.url,
        br: directNetease.br || cleanBr * 1000,
        size: directNetease.size || 0,
        source: env.DEFAULT_SEARCH_SOURCE,
        md5: null,
      };
    }
  }

  if (!matchResult || !matchResult.url) {
    throw new Error("所有可用音源均无法匹配到该歌曲播放链接");
  }

  // 5. 反代 URL 处理
  const finalUrl = matchResult.url;
  const proxyUrl = formatProxyUrl(finalUrl, env.PROXY_URL);

  const responseData: MatchedAudio = {
    id: cleanId,
    url: finalUrl,
    br: matchResult.br || cleanBr * 1000,
    size: matchResult.size || 0,
    source: matchResult.source || "gdstudio",
    md5: matchResult.md5 || null,
    proxyUrl,
    title: detail?.name || "",
    artist: detail?.artist || "",
    album: detail?.album || "",
    pic: detail?.picUrl || "",
  };

  globalCache.set(cacheKey, responseData, env.CACHE_TTL_AUDIO);
  return responseData;
}

/**
 * 获取网易云指定音质歌曲
 */
export async function getNeteaseSong(
  id: string | number,
  br: number | string = env.DEFAULT_BITRATE
): Promise<NcmAudioResult> {
  const cleanId = sanitizeParam(id, 50);
  const cleanBr = (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(Number(br))
    ? Number(br)
    : env.DEFAULT_BITRATE;

  const direct = await gdstudio.getUrl(cleanId, env.DEFAULT_SEARCH_SOURCE, cleanBr);
  if (direct && direct.url) {
    const proxyUrl = formatProxyUrl(direct.url, env.PROXY_URL);
    return {
      id: cleanId,
      br: direct.br || cleanBr,
      url: direct.url,
      size: direct.size || 0,
      source: env.DEFAULT_SEARCH_SOURCE,
      proxyUrl,
    };
  }

  // 自动解灰
  const matched = await matchSong(cleanId, [...PROVIDER_CONFIG.PRIMARY_DECRYPT_PROVIDERS], cleanBr);
  return {
    id: cleanId,
    br: matched.br || cleanBr,
    url: matched.url,
    size: matched.size || 0,
    source: matched.source || env.DEFAULT_AUDIO_SOURCE,
    proxyUrl: matched.proxyUrl || matched.url,
  };
}

/**
 * 从其他音源（酷我/joox等）按歌名搜索并获取播放链接
 */
export async function getOtherSourceSong(name: string): Promise<{ url: string; source: string }> {
  const cleanName = sanitizeParam(name, 100);
  if (!cleanName) {
    throw new Error("缺少歌曲名称参数");
  }

  const cacheKey = `other:${cleanName}`;
  const cached = globalCache.get(cacheKey) as { url: string; source: string } | null;
  if (cached) return cached;

  let searchRes = await gdstudio.search(cleanName, env.DEFAULT_AUDIO_SOURCE, 1, 1);
  let targetSource: string = env.DEFAULT_AUDIO_SOURCE;

  if (!searchRes || searchRes.length === 0) {
    searchRes = await gdstudio.search(cleanName, "kuwo", 1, 1);
    targetSource = "kuwo";
  }

  if (!searchRes || searchRes.length === 0) {
    throw new Error(`未能在其他音源中找到歌曲: ${cleanName}`);
  }

  const songId = searchRes[0].id || searchRes[0].url_id;
  const audio = await gdstudio.getUrl(songId, targetSource, env.DEFAULT_BITRATE);

  if (!audio || !audio.url) {
    throw new Error("未能获取到音频播放链接");
  }

  const result = { url: audio.url, source: targetSource };
  globalCache.set(cacheKey, result, env.CACHE_TTL_AUDIO);
  return result;
}
