import { serve } from "@hono/node-server";
import net from "node:net";
import { app } from "./app.js";
import { env } from "./config/env.js";

// 检测端口与主机可用性
function checkPort(port: number, host = env.HOST): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net
      .createServer()
      .once("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[Host: ${host}] 端口 ${port} 已被占用, 正在尝试下一端口...`);
          server.close();
          resolve(false);
        } else {
          reject(err);
        }
      })
      .once("listening", () => {
        server.close();
        resolve(true);
      })
      .listen(port, host);
  });
}

// 启动服务
async function startServer(): Promise<void> {
  let targetPort = env.PORT;
  let isAvailable = await checkPort(targetPort, env.HOST);
  while (!isAvailable) {
    targetPort++;
    isAvailable = await checkPort(targetPort, env.HOST);
  }

  const server = serve(
    {
      fetch: app.fetch,
      port: targetPort,
      hostname: env.HOST,
    },
    (info) => {
      console.log(`====================================================`);
      console.log(`🚀 UNM-Server (TypeScript + Hono) 启动成功`);
      console.log(`📡 监听地址: http://${info.address}:${info.port}`);
      console.log(`🌐 跨域模式: ${env.ALLOWED_DOMAIN}`);
      console.log(`🎵 音源引擎: GD Studio (music-api.gdstudio.xyz) + UNM`);
      console.log(`🩺 健康检查: http://${info.address}:${info.port}/health`);
      console.log(`====================================================`);
    }
  );

  // 优雅停机
  const handleShutdown = () => {
    console.log("\n正在关闭 UNM-Server 服务...");
    server.close(() => {
      console.log("UNM-Server 服务已安全退出");
      process.exit(0);
    });
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

startServer().catch((err) => {
  console.error("❌ 服务启动失败:", err);
  process.exit(1);
});

export default app;
