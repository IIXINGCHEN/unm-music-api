import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { monitorAuthMiddleware } from "../middlewares/middlewareAuth.js";
import { getEffectiveMonitorSecret } from "../config/index.js";

/**
 * 回归：监控鉴权必须 fail-closed。
 *
 * 历史缺陷：MONITOR_SECRET_KEY 为空时中间件直接 next() 放行，
 * 等于把审计日志（调用方 IP、Referer、完整 URL）对公网开放。
 * 现在密钥由 configEnv 保证非空（未配置时生成进程级 ephemeral 密钥）。
 *
 * 同时覆盖正向路径：若只断言 401，把中间件改成恒返回 401 也能全绿，
 * 那样监控接口被彻底锁死却无人察觉。
 */
function buildApp() {
  const app = new Hono();
  app.use("/api/monitor/*", monitorAuthMiddleware);
  app.use("/api/monitor", monitorAuthMiddleware);
  app.get("/api/monitor/data", (c) => c.json({ ok: true }));
  return app;
}

describe("monitorAuthMiddleware", () => {
  test("无凭据请求返回 401", async () => {
    const res = await buildApp().request("/api/monitor/data");
    assert.equal(res.status, 401);
  });

  test("错误凭据返回 401", async () => {
    const res = await buildApp().request("/api/monitor/data", {
      headers: { "x-api-key": "definitely-wrong" },
    });
    assert.equal(res.status, 401);
  });

  test("无通配形态路径同样受保护", async () => {
    const res = await buildApp().request("/api/monitor");
    assert.equal(res.status, 401);
  });

  test("Authorization: Bearer 形态被纳入校验而非放行", async () => {
    const res = await buildApp().request("/api/monitor/data", {
      headers: { authorization: "Bearer wrong-key" },
    });
    assert.equal(res.status, 401);
  });

  test("正确凭据可放行（防止恒 401 时负向用例全绿）", async () => {
    const secret = getEffectiveMonitorSecret();
    assert.ok(secret, "生效密钥不应为空（未配置时应由 configEnv 生成 ephemeral 密钥）");

    const viaHeader = await buildApp().request("/api/monitor/data", {
      headers: { "x-api-key": secret },
    });
    assert.equal(viaHeader.status, 200, "x-api-key 正确时应放行");

    const viaBearer = await buildApp().request("/api/monitor/data", {
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(viaBearer.status, 200, "Bearer 正确时应放行");

    const viaQuery = await buildApp().request(
      `/api/monitor/data?api_key=${encodeURIComponent(secret)}`
    );
    assert.equal(viaQuery.status, 200, "query api_key 正确时应放行");
  });

  test("未配置 MONITOR_SECRET_KEY 时不会退化为开放访问", () => {
    // configEnv 在密钥为空时生成 ephemeral 值，故此处必须非空
    assert.notEqual(getEffectiveMonitorSecret(), "");
  });
});
