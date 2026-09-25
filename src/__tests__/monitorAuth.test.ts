import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Hono } from "hono";
import { monitorAuthMiddleware } from "../middlewares/middlewareAuth.js";
import { getEffectiveMonitorSecret } from "../config/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 回归：监控鉴权必须 fail-closed。
 *
 * 历史缺陷：MONITOR_SECRET_KEY 为空时中间件直接 next() 放行，
 * 等于把审计日志（调用方 IP、Referer、完整 URL）对公网开放。
 * 现在 configEnv 在启动期强校验该变量存在且非空，缺失即拒绝启动，
 * 因此中间件不存在“未配置即放行”的分支。
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
    assert.ok(secret, "生效密钥不应为空（configEnv 已在启动期强校验其存在）");

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

  test("生效密钥非空（configEnv 启动期已强校验，不存在自动生成的回退值）", () => {
    assert.notEqual(getEffectiveMonitorSecret(), "");
  });

  test("configEnv 不得把密钥写入任何日志或 process.env", () => {
    const src = readFileSync(
      path.join(repoRoot, "src/config/configEnv.ts"),
      "utf-8"
    );
    // 密钥值不得出现在 console.* 输出中
    assert.ok(
      !/console\.\w+\([^)]*MONITOR_SECRET_KEY\s*\}/.test(src) &&
        !/console\.\w+\([^)]*MONITOR_SECRET_KEY\.trim\(\)/.test(src),
      "MONITOR_SECRET_KEY 的值被写入日志"
    );
    // 不得回写 process.env，避免被依赖包或 /info 类端点读取
    assert.ok(
      !/process\.env\.MONITOR_SECRET_KEY\s*=/.test(src),
      "MONITOR_SECRET_KEY 被回写到 process.env"
    );
    // 未配置时必须拒绝启动，而不是放行或生成临时密钥
    assert.ok(
      /process\.exit\(1\)/.test(src),
      "缺少 MONITOR_SECRET_KEY 时未拒绝启动"
    );
    // 不得真的调用 randomBytes 生成密钥。
    // 注意：错误提示文案里会给出生成示例（含 randomBytes 字面量），
    // 故只检查「赋值给变量/常量」的调用形态，而非字符串出现。
    assert.ok(
      !/=\s*crypto\.randomBytes\(|=\s*randomBytes\(/.test(src),
      "仍在自动生成临时密钥（应改为强制配置）"
    );
  });
});
