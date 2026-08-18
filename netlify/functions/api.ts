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
  const incoming = new URL(req.url);
  let path = incoming.pathname;

  // 剥离 Netlify 函数路径前缀，还原业务路径
  const fnPrefix = "/.netlify/functions/api";
  if (path.startsWith(fnPrefix)) {
    path = path.slice(fnPrefix.length) || "/";
  }

  const url = new URL(path + incoming.search, incoming.origin);
  const rebuilt = new Request(url.toString(), req);

  // 提供执行上下文供 Hono 使用（保持 netlify adapter 兼容字段）
  return app.fetch(rebuilt, { context } as any);
}
