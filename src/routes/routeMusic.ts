import { Hono } from "hono";
import { z } from "zod";
import { env, PROVIDER_CONFIG, HTTP_CONFIG } from "../config/index.js";
import {
  matchSong,
  getNeteaseSong,
  getOtherSourceSong,
  getCrossSourceSong,
  getAvailableProviders,
  isRegisteredStreamUrl,
} from "../services/serviceUnm.js";
import { successResponse, errorResponse, parseQuery } from "../utils/utilResponse.js";
import { formatProxyUrl } from "../utils/utilString.js";
import type { ApiResponse } from "../types/typeApi.js";
import type { MatchedAudio, NcmAudioResult } from "../types/typeMusic.js";

const musicRoute = new Hono();

// 已知 provider 白名单（UNM 引擎初始化完成后快照）：过滤 /match?server= 中的未知项，
// 防止任意字符串进入缓存键导致 LRU 缓存抖动，以及无效 server 触发多源降级检索放大上游调用
const KNOWN_PROVIDERS = new Set(getAvailableProviders());

const matchSchema = z.object({
  id: z.string().trim().min(1, "缺少 id 参数").max(80),
  server: z.string().max(200).optional(),
  br: z.string().max(10).optional(),
  // 跨源直取：传入 GD Studio 搜索结果的平台名（kugou/kuwo/joox 等），此时 id 应为该平台的 url_id
  source: z.string().max(30).optional(),
  // 传 true/1 时绕过缓存重新解灰（用于清理已失效的缓存死链）
  refresh: z.string().max(5).optional(),
});

const ncmgetSchema = z.object({
  id: z.string().trim().min(1, "缺少 id 参数").max(50),
  br: z.string().max(10).optional(),
});

const othergetSchema = z.object({
  name: z.string().trim().min(1, "缺少 name 参数").max(100),
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
  const parsed = parseQuery(c, matchSchema);
  if (parsed.err) return parsed.err;
  const { id, server: rawServer, br, source, refresh } = parsed.data;
  const refreshMode = refresh === "true" || refresh === "1";
  const normalizedSource = source ? source.trim().toLowerCase() : "";

  try {
    // 跨源分支：显式携带非 netease 的 source 时，按该平台语义直取直链（id 为该平台 url_id）
    if (normalizedSource && normalizedSource !== "netease") {
      const crossData = await getCrossSourceSong(id, normalizedSource, br || env.DEFAULT_BITRATE, {
        refresh: refreshMode,
      });
      (c as any).set?.("matchedSource", crossData.source);
      return c.json<ApiResponse<MatchedAudio>>(successResponse(crossData, "跨源直链获取成功"));
    }

    // 过滤未知 provider（小写归一）；全部无效时保持空数组，由 matchSong 回退默认音源列表
    const servers = rawServer
      ? rawServer
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s && KNOWN_PROVIDERS.has(s))
      : null;
    const data = await matchSong(id, servers, br || env.DEFAULT_BITRATE, { refresh: refreshMode });
    (c as any).set?.("matchedSource", data.source);
    return c.json<ApiResponse<MatchedAudio>>(successResponse(data, "匹配成功"));
  } catch (error: any) {
    console.error(`[Match Error] id=${id}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `匹配失败: ${error.message}`), 500);
  }
});

// 网易云歌曲直链获取 (/ncmget)
musicRoute.get("/ncmget", async (c) => {
  const parsed = parseQuery(c, ncmgetSchema);
  if (parsed.err) return parsed.err;
  const { id, br } = parsed.data;
  try {
    const data = await getNeteaseSong(id, br || env.DEFAULT_BITRATE);
    return c.json<ApiResponse<NcmAudioResult>>(successResponse(data));
  } catch (error: any) {
    console.error(`[NcmGet Error] id=${id}:`, error.message);
    return c.json<ApiResponse>(errorResponse(500, `获取网易云音乐失败: ${error.message}`), 500);
  }
});

// 音源直链同源中转流 (/stream)：解决 https 页面无法内嵌 http 直链的混合内容问题与第三方防盗链。
// 双通道兜底：优先服务端直连上游；直连失败且配置了 PROXY_URL 时，自动经外部代理前缀重试一次。
// 仅允许转发「本服务签发过且在缓存有效期内」的直链（白名单校验），不构成开放代理。
musicRoute.get("/stream", async (c) => {
  const rawParam = c.req.query("url") || "";
  let targetUrl = rawParam;
  try {
    targetUrl = decodeURIComponent(rawParam);
  } catch {
    /* 编码异常时按原样校验 */
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return c.json<ApiResponse>(errorResponse(400, "无效的音频直链参数"), 400);
  }
  if (!isRegisteredStreamUrl(targetUrl, env.CACHE_TTL_AUDIO)) {
    return c.json<ApiResponse>(errorResponse(403, "该直链未由本服务签发或已超出有效期，请重新获取匹配"), 403);
  }

  // 双通道取流：直连优先，外部代理兜底（PROXY_URL 未配置时保持直连单通道）
  const channelUrls: Array<{ name: string; url: string }> = [{ name: "direct", url: targetUrl }];
  if (env.PROXY_URL) {
    channelUrls.push({ name: "proxy", url: formatProxyUrl(targetUrl, env.PROXY_URL) });
  }

  const rangeHeader = c.req.header("range") || "";
  const lowUrl = targetUrl.toLowerCase();

  // 根据目标直链特征智能补齐防盗链请求头（B站/咪咕/腾讯/酷我/酷狗等）
  const upstreamHeaders: Record<string, string> = {
    "User-Agent": HTTP_CONFIG.BROWSER_USER_AGENT,
    Accept: "*/*",
  };
  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  if (lowUrl.includes("bilivideo") || lowUrl.includes("bilibili") || lowUrl.includes("akamaized.net")) {
    upstreamHeaders["Referer"] = "https://www.bilibili.com/";
    upstreamHeaders["Origin"] = "https://www.bilibili.com";
  } else if (lowUrl.includes("migu.cn")) {
    upstreamHeaders["Referer"] = "https://m.music.migu.cn/";
  } else if (lowUrl.includes("qq.com")) {
    upstreamHeaders["Referer"] = "https://y.qq.com/";
  } else if (lowUrl.includes("kugou.com")) {
    upstreamHeaders["Referer"] = "https://www.kugou.com/";
  } else if (lowUrl.includes("kuwo.cn")) {
    upstreamHeaders["Referer"] = "https://www.kuwo.cn/";
  } else if (lowUrl.includes("joox.com")) {
    upstreamHeaders["Referer"] = "https://www.joox.com/";
    upstreamHeaders["Origin"] = "https://www.joox.com";
  }

  let lastError = "";
  for (const channel of channelUrls) {
    try {
      const upstream = await fetch(channel.url, {
        headers: upstreamHeaders,
        redirect: "follow",
        signal: c.req.raw.signal,
      });

      if (!upstream.ok && upstream.status !== 206) {
        lastError = `通道[${channel.name}] 上游响应异常 (HTTP ${upstream.status})`;
        console.warn(`[Stream] ${lastError}: ${targetUrl}`);
        continue; // 切换下一通道
      }

      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) headers.set("Content-Range", contentRange);

      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "no-store");
      // 观测用：标识本次实际服务的通道（direct / proxy）
      headers.set("X-Stream-Channel", channel.name);

      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error: any) {
      if (c.req.raw.signal.aborted || error?.name === "AbortError") {
        // 客户端主动断开连接（如用户跳曲、拖动进度条、暂停缓冲完毕），正常安静退出
        return new Response(null, { status: 499 });
      }
      lastError = `通道[${channel.name}] 请求失败: ${error.message}`;
      console.warn(`[Stream] ${lastError}: ${targetUrl}`);
      continue;
    }
  }

  return c.json<ApiResponse>(errorResponse(502, `音频流中转失败: ${lastError}`), 502);
});

// 其他音源获取 (/otherget)
musicRoute.get("/otherget", async (c) => {
  const parsed = parseQuery(c, othergetSchema);
  if (parsed.err) return parsed.err;
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
