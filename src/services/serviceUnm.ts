import axios from "axios";
import {
  env,
  AUDIO_CONFIG,
  PROVIDER_CONFIG,
  UPSTREAM_APIS,
  HTTP_CONFIG,
} from "../config/index.js";
import { globalCache } from "./serviceCache.js";
import { gdStudio } from "./serviceGdStudio.js";
import { sanitizeParam, formatProxyUrl } from "../utils/utilString.js";
import type { SongDetail, MatchedAudio, NcmAudioResult } from "../types/typeMusic.js";

// 静态导入 UNM 引擎（Node.js ESM 规范要求深层导入必须显式指定 .js 扩展名）
// @ts-ignore -- UNM 引擎无类型声明文件，运行时以 any 使用
import * as unmConstsNS from "@unblockneteasemusic/server/src/consts.js";
// @ts-ignore -- 同上
import * as unmMatchNS from "@unblockneteasemusic/server";

const unmConsts = unmConstsNS as any;

// ---- 流媒体直链白名单注册表 ----
// /stream 同源中转端点仅允许转发「本服务签发过的」音源直链，防止被滥用为开放代理 (SSRF)
const streamUrlRegistry = new Map<string, number>();
const STREAM_REGISTRY_MAX_ITEMS = 500;

/** 登记一条允许经 /stream 中转的音源直链（FIFO 淘汰最旧条目） */
export function registerStreamUrl(url: string | null | undefined): void {
  const clean = typeof url === "string" ? url.trim() : "";
  if (!clean || !/^https?:\/\//i.test(clean)) return;
  if (streamUrlRegistry.size >= STREAM_REGISTRY_MAX_ITEMS) {
    const oldestKey = streamUrlRegistry.keys().next().value;
    if (oldestKey !== undefined) streamUrlRegistry.delete(oldestKey);
  }
  streamUrlRegistry.set(clean, Date.now());
}

// 受信任音源 CDN 根域白名单（严格子域匹配，杜绝 "xqq.com".endsWith("qq.com") 式裸后缀绕过）
const TRUSTED_STREAM_HOST_SUFFIXES = [
  "joox.com",
  "qq.com",
  "kugou.com",
  "kuwo.cn",
  "migu.cn",
  "bilibili.com",
  "bilivideo.com",
  "bilivideo.cn",
  "akamaized.net",
  "163.com",
  "126.net",
  "music.126.net",
  "bodian.cn",
  "gdstudio.xyz",
] as const;

function isTrustedStreamHost(host: string): boolean {
  const clean = host.toLowerCase();
  return TRUSTED_STREAM_HOST_SUFFIXES.some(
    (suffix) => clean === suffix || clean.endsWith(`.${suffix}`)
  );
}

/** 校验目标直链是否为本服务在有效期内签发过的，或属于受信任的音源 CDN 域名 */
export function isRegisteredStreamUrl(url: string, maxAgeMs: number): boolean {
  if (!url || typeof url !== "string") return false;
  // 1. 内存注册表命中（单机/本地容器）
  const issuedAt = streamUrlRegistry.get(url);
  if (issuedAt !== undefined && Date.now() - issuedAt <= maxAgeMs) {
    return true;
  }
  // 2. 受信任音源 CDN 白名单校验（适配 Serverless/多实例集群/无状态部署，杜绝内存跨实例丢失导致的 403，同时严密阻断 SSRF 风险）
  try {
    const parsed = new URL(url);
    return isTrustedStreamHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * 清洗字符串：去除版本括号、Live/现场/Remix/伴奏前后缀及标点符号，提取纯净名称核心
 */
function cleanSongTitle(str?: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[\(（\[【][^\)）\]】]*(?:live|现场|remix|伴奏|instrumental|version|版|第[0-9一二三四五六七八九十]+期)[^\)）\]】]*[\)）\]】]/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * 智能多源曲目相似度打分器：确保匹配到的第三方音源与目标歌曲及歌手高度一致
 */
function findBestMatchingTrack(
  list: any[],
  expectedName?: string,
  expectedArtist?: string
): any | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (!expectedName && !expectedArtist) return list[0];

  const targetCleanTitle = cleanSongTitle(expectedName);
  const targetArtists = (expectedArtist || "")
    .toLowerCase()
    .split(/[\/,&\s+、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bestItem: any = null;
  let bestScore = -1;

  for (const item of list) {
    let score = 0;
    const itemName = item.name || item.title || "";
    const itemCleanTitle = cleanSongTitle(itemName);
    const itemArtist = Array.isArray(item.artist)
      ? item.artist.join(" ")
      : (item.artist || item.singer || "");
    const lowItemArtist = itemArtist.toLowerCase();

    // 1. 歌曲名比对 (最高 60 分)
    if (expectedName && itemName.toLowerCase() === expectedName.toLowerCase()) {
      score += 60;
    } else if (targetCleanTitle && itemCleanTitle === targetCleanTitle) {
      score += 50;
    } else if (
      targetCleanTitle &&
      (itemCleanTitle.includes(targetCleanTitle) || targetCleanTitle.includes(itemCleanTitle))
    ) {
      score += 30;
    }

    // 2. 歌手名比对 (最高 40 分)
    if (targetArtists.length > 0) {
      let matchedArtists = 0;
      for (const a of targetArtists) {
        if (lowItemArtist.includes(a)) {
          matchedArtists++;
        }
      }
      if (matchedArtists === targetArtists.length) {
        score += 40;
      } else if (matchedArtists > 0) {
        score += Math.round((40 * matchedArtists) / targetArtists.length);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  // 若最佳评分有效（≥30 分）或无明确预期则采纳最佳，否则返回候选列表第 1 项兜底
  return bestScore >= 30 ? bestItem : list[0];
}

/**
 * 关键词检索取链：按音源优先级依次尝试 GD Studio「搜索 + 取直链」（遵循 url_id 语义），全部失败返回 null
 */
async function fetchAudioByKeyword(
  keyword: string,
  br: number,
  expectedName?: string,
  expectedArtist?: string,
  sources: string[] = [env.DEFAULT_AUDIO_SOURCE, "kuwo", "kugou", "joox", "bilibili"]
): Promise<{ url: string; br: number; size: number; source: string } | null> {
  const orderedSources = [...new Set(sources.map((s) => String(s).toLowerCase()).filter(Boolean))];
  for (const source of orderedSources) {
    try {
      const list = await gdStudio.search(keyword, source, 6, 1);
      if (!Array.isArray(list) || list.length === 0) continue;
      const target = findBestMatchingTrack(list, expectedName, expectedArtist);
      if (!target) continue;
      const audio = await gdStudio.getUrl((target as any).url_id || target.id, source, br);
      if (audio && audio.url) {
        return {
          url: audio.url,
          br: audio.br || br * 1000,
          size: audio.size || 0,
          source,
        };
      }
    } catch {
      continue; // 单个音源失败不阻塞后续音源尝试
    }
  }
  return null;
}

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
        const artistName = (info.artists || []).map((a: any) => a.name).join(" / ");
        const keyword = `${info.name || ""} ${artistName}`.trim();
        if (!keyword) return null;
        const audio = await fetchAudioByKeyword(
          keyword,
          Number(info.br) || env.DEFAULT_BITRATE,
          info.name || undefined,
          artistName || undefined
        );
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
        const audio = await gdStudio.getUrl(info.id, env.DEFAULT_SEARCH_SOURCE, info.br || env.DEFAULT_BITRATE);
        if (audio && audio.url) {
          return audio.url;
        }
        return await unmConsts.PROVIDERS.gdstudio?.check(info);
      } catch {
        return null;
      }
    },
  };

  // 3. 修复/增强 joox Provider（免自备 Cookie 解析，通过 GD Studio 检索）
  unmConsts.PROVIDERS.joox = {
    async check(info: any) {
      try {
        const keyword = `${info.name || ""} ${info.artists?.[0]?.name || ""}`.trim();
        if (!keyword) return null;
        const list = await gdStudio.search(keyword, "joox", 5, 1);
        if (!Array.isArray(list) || list.length === 0) return null;

        const target = list.find((item) => item.name === info.name) || list[0];
        const audio = await gdStudio.getUrl((target as any).url_id || target.id, "joox", info.br || env.DEFAULT_BITRATE);
        return audio?.url || null;
      } catch {
        return null;
      }
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
  br: number | string = env.DEFAULT_BITRATE,
  opts: { refresh?: boolean } = {}
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
  if (!opts.refresh) {
    const cached = globalCache.get(cacheKey) as MatchedAudio | null;
    if (cached) {
      // 缓存命中同样登记直链，保证 /stream 同源中转在缓存有效期内可用
      registerStreamUrl(cached.url);
      return cached;
    }
  }

  // 1. 获取网易云元数据
  const detail = await getNeteaseSongDetail(cleanId);

  // 2. 尝试使用 UNM 引擎进行多源匹配（ESM 命名空间下取 default 导出）
  const unmMatchFn: any = (unmMatchNS as any).default ?? unmMatchNS;
  let matchResult: { url?: string; br?: number; size?: number; source?: string; md5?: string | null } | null = null;
  try {
    const songData = detail
      ? {
          id: cleanId,
          name: detail.name,
          artists: detail.artist.split(" / ").map((n) => ({ name: n })),
          album: { name: detail.album, picUrl: detail.picUrl },
          duration: detail.duration,
          br: cleanBr,
        }
      : undefined;
    matchResult = await unmMatchFn(cleanId, serverList, songData);
  } catch {
    console.warn(`[UNM Match] UNM 引擎直接匹配未命中 (${cleanId})，启动备选智能降级...`);
  }

  // 3. 若 UNM 未能返回 URL，使用 GD Studio 关键词多源智能检索降级（joox -> kuwo -> kugou -> bilibili）
  if (!matchResult || !matchResult.url) {
    if (detail && detail.name) {
      const keyword = `${detail.name} ${detail.artist}`.trim();
      const kwAudio = await fetchAudioByKeyword(keyword, cleanBr, detail.name, detail.artist);
      if (kwAudio) {
        matchResult = {
          url: kwAudio.url,
          br: kwAudio.br,
          size: kwAudio.size,
          source: kwAudio.source,
          md5: null,
        };
      }
    }
  }

  // 4. 再次降级：直接尝试 GD Studio 的 netease 源
  if (!matchResult || !matchResult.url) {
    const directNetease = await gdStudio.getUrl(cleanId, env.DEFAULT_SEARCH_SOURCE, cleanBr);
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

  // 5. 反代 URL 处理与 /stream 中转白名单登记
  const finalUrl = matchResult.url;
  const proxyUrl = formatProxyUrl(finalUrl, env.PROXY_URL);
  registerStreamUrl(finalUrl);

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

  const direct = await gdStudio.getUrl(cleanId, env.DEFAULT_SEARCH_SOURCE, cleanBr);
  if (direct && direct.url) {
    const proxyUrl = formatProxyUrl(direct.url, env.PROXY_URL);
    registerStreamUrl(direct.url);
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

  let searchRes = await gdStudio.search(cleanName, env.DEFAULT_AUDIO_SOURCE, 1, 1);
  let targetSource: string = env.DEFAULT_AUDIO_SOURCE;

  if (!searchRes || searchRes.length === 0) {
    searchRes = await gdStudio.search(cleanName, "kuwo", 1, 1);
    targetSource = "kuwo";
  }

  if (!searchRes || searchRes.length === 0) {
    throw new Error(`未能在其他音源中找到歌曲: ${cleanName}`);
  }

  // GD Studio 搜索结果中取播放链接应使用 url_id（与歌曲 id 不同时），缺失时回退 id
  const songId = (searchRes[0] as any).url_id || searchRes[0].id;
  const audio = await gdStudio.getUrl(songId, targetSource, env.DEFAULT_BITRATE);

  if (!audio || !audio.url) {
    throw new Error("未能获取到音频播放链接");
  }

  registerStreamUrl(audio.url);
  const result = { url: audio.url, source: targetSource };
  globalCache.set(cacheKey, result, env.CACHE_TTL_AUDIO);
  return result;
}

/**
 * 跨源直链获取：按「搜索结果返回的平台 + 该平台曲目 ID（url_id）」直接取播放链接，
 * 不再误走网易 ID 解灰管线。供 /match?source=xxx 分支调用。
 */
export async function getCrossSourceSong(
  id: string | number,
  source: string,
  br: number | string = env.DEFAULT_BITRATE,
  opts: { refresh?: boolean } = {}
): Promise<MatchedAudio> {
  const cleanId = sanitizeParam(id, 80);
  const cleanSource = sanitizeParam(source, 30).toLowerCase();
  if (!cleanId) {
    throw new Error("缺少音源曲目 ID 参数");
  }
  if (!cleanSource) {
    throw new Error("缺少音源平台参数 source");
  }

  const cleanBr = (AUDIO_CONFIG.SUPPORTED_BITRATES as readonly number[]).includes(Number(br))
    ? Number(br)
    : env.DEFAULT_BITRATE;

  const cacheKey = `cross:${cleanSource}:${cleanId}:${cleanBr}`;
  if (!opts.refresh) {
    const cached = globalCache.get(cacheKey) as MatchedAudio | null;
    if (cached) {
      registerStreamUrl(cached.url);
      return cached;
    }
  }

  const audio = await gdStudio.getUrl(cleanId, cleanSource, cleanBr);
  if (!audio || !audio.url) {
    throw new Error(`音源 ${cleanSource} 未能返回该曲目的播放链接`);
  }

  const finalUrl = audio.url;
  const proxyUrl = formatProxyUrl(finalUrl, env.PROXY_URL);
  registerStreamUrl(finalUrl);

  const responseData: MatchedAudio = {
    id: cleanId,
    url: finalUrl,
    br: audio.br || cleanBr * 1000,
    size: audio.size || 0,
    source: cleanSource,
    md5: null,
    proxyUrl,
    title: "",
    artist: "",
    album: "",
    pic: "",
  };

  globalCache.set(cacheKey, responseData, env.CACHE_TTL_AUDIO);
  return responseData;
}
