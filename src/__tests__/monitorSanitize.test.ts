import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { monitorService } from "../services/serviceMonitor.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf-8");

/**
 * 回归：监控入库字段必须全部脱敏。
 *
 * 历史缺陷：record() 只对 fullUrl 与 query 调 sanitizeUrl，
 * referer / origin / path 原样写入，凭据经 /api/monitor/data 回显到鉴权大盘；
 * topCallers[].name 也由同一份未脱敏 Referer 派生，endpointMap 亦以原始 path 为键。
 *
 * 注意：monitorService 是跨文件共享的进程级单例，本文件用例从 clear() 到
 * getData() 之间必须保持同步，不得插入 await。
 */
describe("监控字段脱敏", () => {
  test("record() 写入的字段不含明文凭据", () => {
    monitorService.clear();
    monitorService.record({
      method: "GET",
      path: "/;token=PATHSECRET",
      fullUrl: "http://h/match?token=URLSECRET",
      query: { token: "QUERYSECRET" },
      status: 200,
      duration: 1,
      ip: "203.0.113.9",
      referer: "https://ref.example/p?token=REFSECRET",
      origin: "https://origin.example?token=ORIGINSECRET",
      userAgent: "node-test",
    });

    const snapshot = JSON.stringify(monitorService.getData({ page: 1, limit: 10 }));
    for (const secret of [
      "PATHSECRET",
      "URLSECRET",
      "QUERYSECRET",
      "REFSECRET",
      "ORIGINSECRET",
    ]) {
      assert.ok(!snapshot.includes(secret), `凭据 ${secret} 泄露到大盘快照`);
    }
    monitorService.clear();
  });

  test("endpointMap 以脱敏后的 path 为键（topEndpoints 不回显凭据）", () => {
    const src = read("src/services/serviceMonitor.ts");
    assert.ok(
      !/bumpCount\(this\.endpointMap,\s*logData\.path\)/.test(src),
      "endpointMap 仍以原始 path 为键，会经 topEndpoints 绕过脱敏"
    );
    assert.ok(
      /bumpCount\(this\.endpointMap,\s*cleanedPath\)/.test(src),
      "endpointMap 未使用脱敏后的 path"
    );
  });

  test("callerName 的解析失败兜底分支经过脱敏", () => {
    const src = read("src/services/serviceMonitor.ts");
    assert.ok(
      !/callerName\s*=\s*logData\.referer\.slice/.test(src),
      "callerName 兜底分支直接截断原始 Referer"
    );
    assert.ok(
      /callerName\s*=\s*sanitizeUrl\(logData\.referer\)/.test(src),
      "callerName 兜底分支未脱敏"
    );
  });
});
