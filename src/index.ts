import { serve } from "@hono/node-server";
import net from "node:net";
import { app } from "./app.js";
import { env } from "./config/configEnv.js";

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

  // 优雅停机：先停止接收新连接并等待存量请求收尾；
  // 若存在长音频流等挂起连接，宽限期到后强制断开退出，避免 SIGTERM 被无限拖延（容器编排超时强杀）
  const handleShutdown = () => {
    console.log("\n正在关闭 UNM-Server 服务...");
    // ServerType 联合类型含 Http2 变体（无 close*Connections 方法），运行时守卫收窄
    const httpServer = server as unknown as {
      closeAllConnections?: () => void;
      closeIdleConnections?: () => void;
    };
    const forceExitTimer = setTimeout(() => {
      console.warn("优雅关闭超时，强制断开全部连接并退出");
      httpServer.closeAllConnections?.();
      process.exit(0);
    }, 8000);
    forceExitTimer.unref?.();
    server.close(() => {
      clearTimeout(forceExitTimer);
      console.log("UNM-Server 服务已安全退出");
      process.exit(0);
    });
    // 立即回收空闲的 keep-alive 连接加速排空；在途请求继续等待自然完成
    httpServer.closeIdleConnections?.();
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

startServer().catch((err) => {
  console.error("❌ 服务启动失败:", err);
  process.exit(1);
});
