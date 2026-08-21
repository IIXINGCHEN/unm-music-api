import { Hono } from "hono";
import { MONITOR_CONFIG } from "../config/index.js";
import { monitorService } from "../services/serviceMonitor.js";
import { monitorAuthMiddleware } from "../middlewares/middlewareAuth.js";
import { successResponse } from "../utils/utilResponse.js";

const monitorRoute = new Hono();

// 挂载监控鉴权中间件（当配置了 MONITOR_SECRET_KEY 时生效）
monitorRoute.use("/api/monitor/*", monitorAuthMiddleware);

// 获取监控数据与请求明细
monitorRoute.get("/api/monitor/data", (c) => {
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
});

// 清空调用日志
monitorRoute.post("/api/monitor/clear", (c) => {
  monitorService.clear();
  return c.json(successResponse({ cleared: true }, "监控日志已清空"));
});

export { monitorRoute };
