import { app } from "../../src/app.js";

// Netlify Functions 双签名兼容适配层
//
// 背景：函数经 esbuild 打包为 CJS 后，Netlify 按旧版签名调用：
//   handler(event, context, callback)  —— event 是 Lambda 风格对象
// 而非新版标准签名 handler(Request, context)。
// 旧签名下 req.url / req.headers / req.text 均不存在，导致
// Invalid URL / getPath undefined / req.text is not a function 等崩溃。
//
// 此适配层检测两种签名并统一转换为标准 Request 后交给 Hono。

export const config = {
  path: "/*",
  preferStatic: true,
};

type LegacyEvent = {
  httpMethod?: string;
  path?: string;
  rawUrl?: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type NetlifyContext = {
  pathname?: string;
  [key: string]: unknown;
};

function isLegacyEvent(arg: any): arg is LegacyEvent {
  return arg && typeof arg === "object" && !("text" in arg) &&
    ("httpMethod" in arg || "rawUrl" in arg || "path" in arg);
}

function buildRequest(
  method: string,
  rawUrl: string,
  headers: Record<string, string>,
  body: string | null,
): Request {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    url = new URL(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`, "https://netlify.local");
  }

  // 剥离 Netlify 函数路径前缀，还原业务路径
  const fnPrefix = "/.netlify/functions/api";
  if (url.pathname.startsWith(fnPrefix)) {
    const rest = url.pathname.slice(fnPrefix.length) || "/";
    return new Request(new URL(rest + url.search, url.origin).toString(), {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : (body || undefined),
    });
  }

  return new Request(url.toString(), {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : (body || undefined),
  });
}

export async function handler(arg0: any, context: NetlifyContext): Promise<Response> {
  let request: Request;

  if (isLegacyEvent(arg0)) {
    // 旧版签名：Lambda event 对象
    const ev = arg0;
    const qs = ev.queryStringParameters || {};
    const search = new URLSearchParams(qs).toString();
    const rawUrl = ev.rawUrl || `${(ev.path || "/")}${search ? "?" + search : ""}`;
    request = buildRequest(ev.httpMethod || "GET", rawUrl, ev.headers || {}, ev.body || null);
  } else if (arg0 instanceof Request) {
    // 新版签名：标准 Request（保留前缀剥离逻辑）
    request = buildRequest(arg0.method, arg0.url, Object.fromEntries(arg0.headers.entries()), null);
  } else {
    // 未知形态：尽力兜底
    request = buildRequest("GET", (context?.pathname as string) || "/", {}, null);
  }

  return app.fetch(request, { context } as any);
}
