import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs/promises";
import { env, APP_INFO, HTTP_CONFIG } from "./config/index.js";
import { routes } from "./routes/index.js";
import { monitorService } from "./services/serviceMonitor.js";
import { rateLimitMiddleware } from "./middlewares/middlewareRateLimit.js";
import { isAllowedDomain } from "./utils/utilSecurity.js";
import { errorResponse, successResponse } from "./utils/utilResponse.js";
import { resolvePublicFile } from "./utils/utilPath.js";
import type { ApiResponse } from "./types/typeApi.js";

const app = new Hono();

// 1. 全局请求耗时计算与遥测日志记录中间件
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header("X-Response-Time", `${duration}ms`);

  // 记录监控日志
  const pathName = c.req.path;
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "127.0.0.1";
  const referer = c.req.header("referer") || "";
  const origin = c.req.header("origin") || "";
  const userAgent = c.req.header("user-agent") || "";
  const fullUrl = c.req.url;
  const query = c.req.query();
  const status = (c.res as any).status || 200;

  monitorService.record({
    method: c.req.method,
    path: pathName,
    fullUrl,
    query,
    status,
    duration,
    ip,
    referer,
    origin,
    userAgent,
    source: ((c as any).get?.("matchedSource") as string) || undefined,
  });
});

// 2. 基础安全响应头增强
app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
  })
);

// 3. API 速率限制防护中间件 (滑动窗口防爬防 DDoS)
app.use("*", rateLimitMiddleware);

// 4. CORS 跨域控制 (基于严谨 Hostname 校验)
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (env.ALLOWED_DOMAIN === HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN || !origin) {
        return "*";
      }
      if (isAllowedDomain(origin, env.ALLOWED_DOMAIN)) {
        return origin;
      }
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS", "HEAD"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
      "x-api-key",
      "api_key",
    ],
    exposeHeaders: [
      "Content-Length",
      "Date",
      "X-Response-Time",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
    ],
    maxAge: 86400,
  })
);

// 5. 严格域名访问控制中间件
app.use("*", async (c, next) => {
  if (env.ALLOWED_DOMAIN === HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN || c.req.method === "OPTIONS") {
    return await next();
  }

  const origin = c.req.header("Origin");
  const referer = c.req.header("Referer");

  const isOriginAllowed = origin ? isAllowedDomain(origin, env.ALLOWED_DOMAIN) : false;
  const isRefererAllowed = referer ? isAllowedDomain(referer, env.ALLOWED_DOMAIN) : false;

  if (!origin && !referer) {
    // 允许直接 API 调用或服务端无 Referer 代理转发
    return await next();
  } else if (isOriginAllowed || isRefererAllowed) {
    return await next();
  } else {
    return c.json<ApiResponse>(
      errorResponse(403, "Forbidden: 请求来源域名未在授权白名单内 (CORS/Referer Forbidden)"),
      403
    );
  }
});

// 6. 挂载 API 业务与监控路由
app.route("/", routes);

// 7. 首页与监控大盘页面服务
// ---- 页面样式服务端内联：消除刷新时样式表往返造成的首帧闪烁（FOUC） ----
const cssCache = new Map<string, { mtime: number; css: string }>();
const readCss = async (file: string): Promise<string> => {
  const path = resolvePublicFile(file);
  if (!path) return "";
  const st = await fs.stat(path);
  const cached = cssCache.get(file);
  if (cached && cached.mtime === st.mtimeMs) return cached.css;
  const css = await fs.readFile(path, "utf-8");
  cssCache.set(file, { mtime: st.mtimeMs, css });
  return css;
};
const buildPageStyle = async (files: string[]): Promise<string> => {
  const parts = await Promise.all(files.map((f) => readCss(f)));
  return `<style>/* inline page css */${parts.join("\n")}</style>`;
};
const injectPageCss = (html: string, style: string) =>
  html.includes("<!--INLINE_PAGE_CSS-->") ? html.replace("<!--INLINE_PAGE_CSS-->", () => style) : html;
app.get("/", async (c) => {
  const htmlPath = resolvePublicFile("index.html");
  if (htmlPath) {
    try {
      let html = await fs.readFile(htmlPath, "utf-8");
      html = injectPageCss(html, await buildPageStyle(["assets/css/tailwind.css", "assets/css/main.css", "assets/css/player.css"]));
      // no-cache：确保部署后浏览器立即拉取新页面，防止旧 HTML 引用已删除资源导致无样式渲染
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      /* fallthrough */
    }
  }
  return c.json(
    successResponse(
      { version: APP_INFO.VERSION, status: "running" },
      "UNM-Server 服务正常运行"
    )
  );
});

// 监控大盘路由 (/dashboard & /monitor)
const handleDashboard = async (c: any) => {
  const htmlPath = resolvePublicFile("dashboard.html");
  if (htmlPath) {
    try {
      let html = await fs.readFile(htmlPath, "utf-8");
      html = injectPageCss(html, await buildPageStyle(["assets/css/tailwind.css", "assets/css/dashboard.css"]));
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      /* fallthrough */
    }
  }
  return c.text("Dashboard not found", 404);
};

app.get("/dashboard", handleDashboard);
app.get("/monitor", handleDashboard);

app.use("/*", serveStatic({ root: "./public" }));

// 8. 404 兜底处理
app.notFound(async (c) => {
  const accept = c.req.header("Accept") || "";
  if (accept.includes("text/html")) {
    const notFoundPath = resolvePublicFile("404.html");
    if (notFoundPath) {
      try {
        let html = await fs.readFile(notFoundPath, "utf-8");
        html = injectPageCss(html, await buildPageStyle(["assets/css/tailwind.css", "assets/css/404.css"]));
        return c.html(html, 404);
      } catch {
        /* fallthrough */
      }
    }
    return c.text("404 Not Found", 404);
  }

  return c.json<ApiResponse>(errorResponse(404, "请求的 API 接口不存在"), 404);
});

// 9. 全局未捕获异常兜底处理
app.onError((err, c) => {
  console.error(`[Unhandled Error] ${c.req.method} ${c.req.url} - ${err.message}`, err.stack);
  return c.json<ApiResponse>(
    errorResponse(500, "服务器内部错误，请稍后重试"),
    500
  );
});

export { app };
