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
    // 与主应用 cors() 行为对齐：不开启 credentials（避免 Origin 反射 + 凭证组合的过度授权）
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With, x-api-key, api_key");

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
