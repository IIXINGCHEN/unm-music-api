import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

const listener = getRequestListener(app.fetch);

// CORS 统一由 Hono 应用内的 cors() 中间件处理（src/app.ts），
// 此处不再手工设置任何 Access-Control-* 头，避免多值头导致浏览器拒绝。
export default function handler(req: any, res: any) {
  // 将 Node.js IncomingMessage 与 ServerResponse 接入 Hono 应用
  return listener(req, res);
}
