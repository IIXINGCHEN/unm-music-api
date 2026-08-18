import { app } from "../../src/app.js";

// Netlify Functions 适配层
// hono/netlify 官方 handle 直接透传 Netlify Request 对象，
// 其原始 URL 不含函数路径前缀导致 getPath 收到 undefined 崩溃。
// 此处手动构造标准 Request（剥掉 /.netlify/functions/api 前缀）再交 app.fetch。
export const config = {
  path: "/*",
  preferStatic: true,
};

type NetlifyContext = {
  pathname?: string;
  [key: string]: unknown;
};

export async function handler(req: Request, context: NetlifyContext): Promise<Response> {
  // Netlify 传入的 req.url 在某些打包环境下为空/非法，逐级兜底重建
  let incoming: URL;
  try {
    incoming = new URL(req.url);
  } catch {
    const rawPath = (context?.pathname as string) || "/";
    incoming = new URL(rawPath, "https://netlify.local");
  }

  let path = incoming.pathname;

  // 剥离 Netlify 函数路径前缀，还原业务路径
  const fnPrefix = "/.netlify/functions/api";
  if (path.startsWith(fnPrefix)) {
    path = path.slice(fnPrefix.length) || "/";
  }

  const origin = incoming.origin !== "null" && incoming.origin ? incoming.origin : "https://netlify.local";
  const url = new URL(path + incoming.search, origin);

  // 重建 Request（仅 GET/HEAD 等无体请求可直接复制；带体请求保守处理）
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    redirect: "manual",
  };
  const rebuilt = new Request(url.toString(), init);

  // 提供执行上下文供 Hono 使用（保持 netlify adapter 兼容字段）
  return app.fetch(rebuilt, { context } as any);
}
