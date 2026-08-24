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
  return arg && typeof arg === "object" && !("text" in arg) &&
    ("httpMethod" in arg || "rawUrl" in arg || "path" in arg || "headers" in arg);
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

  // Set-Cookie 多值保护：Headers.forEach 会把重复头合并为逗号拼接串而破坏 Cookie 语义；
  // 存在多枚 Cookie 时按 Lambda 规范改用 multiValueHeaders 传递
  const headersWithGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  let multiValueHeaders: Record<string, string[]> | undefined;
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    const cookies = headersWithGetSetCookie.getSetCookie();
    if (cookies.length > 0) {
      delete headers["set-cookie"];
      multiValueHeaders = { "set-cookie": cookies };
    }
  }

  const contentType = res.headers.get("content-type") || "";
  let body: string = "";
  let isBase64Encoded = false;

  // 二进制安全判定：音频/图片等二进制载荷必须 base64 编码返回，
  // 不能因 GET 方法而走 text() 分支（否则 /stream 音频流会被 UTF-8 解码损坏）
  const isTextual =
    contentType.includes("json") ||
    contentType.includes("text") ||
    contentType.includes("html") ||
    contentType.includes("xml") ||
    contentType.includes("javascript");

  if (isTextual || request.method === "HEAD") {
    body = await res.text();
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    body = Buffer.from(buf).toString("base64");
    isBase64Encoded = true;
  }

  const lambdaResult: Record<string, unknown> = {
    statusCode: res.status,
    headers,
    body,
    isBase64Encoded,
  };
  if (multiValueHeaders) {
    lambdaResult.multiValueHeaders = multiValueHeaders;
  }

  if (isCallbackStyle) {
    callback(null, lambdaResult);
  }

  return lambdaResult;
}
