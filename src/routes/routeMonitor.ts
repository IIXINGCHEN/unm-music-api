import { Hono } from "hono";
import { MONITOR_CONFIG } from "../config/index.js";
import { monitorService } from "../services/serviceMonitor.js";
import { monitorAuthMiddleware } from "../middlewares/middlewareAuth.js";
import { successResponse } from "../utils/utilResponse.js";

const monitorRoute = new Hono();

// 挂载监控鉴权中间件（当配置了 MONITOR_SECRET_KEY 时生效）
// 双路径注册原因：
//   - /api/monitor/*：独立部署（node/dist/docker）的原始规范路径
//   - /monitor/*    ：Serverless 平台路径。Vercel 重写排除 /api 前缀、Netlify 转发会剥掉
//                     /.netlify/functions/api 前缀，导致应用侧收到的是去前缀路径；
//                     业务路由均挂根路径，唯独监控曾用完整 /api 前缀而在双平台 404
const dataHandler = (c: any) => {
  const query = c.req.query();
  const page = query.page ? parseInt(query.page, 10) : MONITOR_CONFIG.DEFAULT_PAGE;
  const limit = query.limit ? parseInt(query.limit, 10) : MONITOR_CONFIG.DEFAULT_LIMIT;
  const path = query.path || "";
  const status = query.status || "";
  const keyword = query.keyword || "";

  const data = monitorService.getData({
    page,
    limit,
    path,
    status,
    keyword,
  });

  return c.json(successResponse(data, "获取监控数据成功"));
};

const clearHandler = (c: any) => {
  monitorService.clear();
  return c.json(successResponse({ cleared: true }, "监控日志已清空"));
};

monitorRoute.use("/api/monitor/*", monitorAuthMiddleware);
monitorRoute.use("/monitor/*", monitorAuthMiddleware);

// 获取监控数据与请求明细
monitorRoute.get("/api/monitor/data", dataHandler);
monitorRoute.get("/monitor/data", dataHandler);

// 清空调用日志
monitorRoute.post("/api/monitor/clear", clearHandler);
monitorRoute.post("/monitor/clear", clearHandler);

export { monitorRoute };
