import { app } from "../../src/app.js";

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
  multiValueQueryStringParameters?: Record<string, string[]>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type NetlifyContext = {
  callbackWaitsForEmptyEventLoop?: boolean;
  pathname?: string;
  [key: string]: unknown;
};

function isLegacyEvent(arg: any): arg is LegacyEvent {
  if (!arg || typeof arg !== "object" || arg instanceof Request) return false;
  return (
    Object.hasOwn(arg, "httpMethod") ||
    Object.hasOwn(arg, "rawUrl") ||
    Object.hasOwn(arg, "path") ||
    Object.hasOwn(arg, "headers")
  );
}

function buildRequestFromEvent(ev: LegacyEvent): Request {
  const method = ev.httpMethod || "GET";
  const rawPath = ev.path || "/";

  // 剥离 Netlify 函数路径前缀，还原真实的 API 路由 (如 /.netlify/functions/api/info -> /info)
  const fnPrefix = "/.netlify/functions/api";
  const cleanPath = rawPath.startsWith(fnPrefix)
    ? rawPath.slice(fnPrefix.length) || "/"
    : rawPath;

  // 组装 Query 参数
  const searchParams = new URLSearchParams();
  if (ev.queryStringParameters) {
    for (const [k, v] of Object.entries(ev.queryStringParameters)) {
      if (v !== undefined && v !== null) {
        searchParams.append(k, String(v));
      }
    }
  }
  // Netlify legacy 事件的多值参数（?id=1&id=2）：queryStringParameters 只保留最后一个值，
  // 需从 multiValueQueryStringParameters 补回全部值；已存在的相同 key+value 去重跳过
  if (ev.multiValueQueryStringParameters) {
    for (const [k, values] of Object.entries(ev.multiValueQueryStringParameters)) {
      if (!Array.isArray(values)) continue;
      for (const v of values) {
        if (v === undefined || v === null) continue;
        const sv = String(v);
        if (searchParams.getAll(k).includes(sv)) continue;
        searchParams.append(k, sv);
      }
    }
  }

  const search = searchParams.toString();
  const fullUrl = `https://netlify.local${cleanPath}${search ? "?" + search : ""}`;

  let body: string | Buffer | undefined = undefined;
  if (!["GET", "HEAD"].includes(method.toUpperCase()) && ev.body) {
    body = ev.isBase64Encoded
      ? Buffer.from(ev.body, "base64")
      : ev.body;
  }

  return new Request(fullUrl, {
    method,
    headers: ev.headers || {},
    body,
  });
}

export async function handler(event: any, contextArg: any, callback?: any): Promise<any> {
  const context: NetlifyContext = (contextArg && typeof contextArg === "object" ? contextArg : {}) as NetlifyContext;
  // 关键：禁止 Lambda 等待 Node.js 事件循环清空（防止 background timers / 连接池导致 30 秒超时）
  context.callbackWaitsForEmptyEventLoop = false;

  const isCallbackStyle = typeof callback === "function";

  let request: Request;
  if (isLegacyEvent(event)) {
    request = buildRequestFromEvent(event);
  } else if (event instanceof Request) {
    const incoming = new URL(event.url);
    const fnPrefix = "/.netlify/functions/api";
    let path = incoming.pathname;
    if (path.startsWith(fnPrefix)) {
      path = path.slice(fnPrefix.length) || "/";
    }
    request = new Request(new URL(path + incoming.search, incoming.origin).toString(), event);
  } else {
    request = new Request("https://netlify.local/", { method: "GET" });
  }

  const res: Response = await app.fetch(request, { context } as any);

  // 构造标准 Lambda 响应对象
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const contentType = res.headers.get("content-type") || "";
  let body: string = "";
  let isBase64Encoded = false;

  if (["GET", "HEAD"].includes(request.method) || contentType.includes("json") || contentType.includes("text") || contentType.includes("html")) {
    body = await res.text();
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    body = Buffer.from(buf).toString("base64");
    isBase64Encoded = true;
  }

  const lambdaResult = {
    statusCode: res.status,
    headers,
    body,
    isBase64Encoded,
  };

  if (isCallbackStyle) {
    callback(null, lambdaResult);
  }

  return lambdaResult;
}
