import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

const listener = getRequestListener(app.fetch);

export default function handler(req: any, res: any) {
  // 1. 全域 CORS 响应头注入
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization, X-Requested-With, Accept, Origin, Accept-Version, Content-Length");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // 2. OPTIONS 预检请求秒级响应
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // 3. 将 Node.js IncomingMessage 与 ServerResponse 接入 Hono 应用
  return listener(req, res);
}
