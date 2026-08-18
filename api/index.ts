import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  // 1. 边缘 OPTIONS 预检请求秒级响应
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-api-key, Authorization, X-Requested-With, Accept, Origin, Accept-Version, Content-Length",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  // 2. 交由 Hono 路由与音源引擎处理
  return app.fetch(req);
}
