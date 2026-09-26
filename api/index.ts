import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app.js";
import { env, HTTP_CONFIG } from "../src/config/index.js";
import { isAllowedDomain } from "../src/utils/utilSecurity.js";

export const config = {
  runtime: "nodejs",
};

const listener = getRequestListener(app.fetch);

export default function handler(req: any, res: any) {
  const reqOrigin = req.headers?.origin || req.headers?.Origin;
  let allowOrigin = "*";

  if (env.ALLOWED_DOMAIN !== HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN) {
    if (reqOrigin && isAllowedDomain(reqOrigin, env.ALLOWED_DOMAIN)) {
      allowOrigin = reqOrigin;
    } else if (!reqOrigin) {
      allowOrigin = "*";
    } else {
      allowOrigin = "";
    }
  }

  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    if (allowOrigin !== "*") {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization, X-Requested-With, Accept, Origin, Accept-Version, Content-Length");

  // OPTIONS 预检请求响应
  if (req.method === "OPTIONS") {
    if (!allowOrigin && reqOrigin && env.ALLOWED_DOMAIN !== HTTP_CONFIG.DEFAULT_ALLOWED_ORIGIN) {
      res.statusCode = 403;
      res.end("Forbidden: CORS origin not allowed");
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  // 将 Node.js IncomingMessage 与 ServerResponse 接入 Hono 应用
  return listener(req, res);
}
