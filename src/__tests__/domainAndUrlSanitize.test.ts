import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAllowedDomain, sanitizeUrl } from "../utils/utilSecurity.js";

/**
 * 回归：端口约束必须对所有 host 匹配分支生效，且能识别与协议默认端口相同的显式端口。
 *
 * 历史缺陷有两层：
 *  1. 端口检查只加在精确 host 分支，泛域名分支（*.example.com:3000）放行任意端口。
 *  2. 即使加上检查，若读 new URL(x).port，则 "https://x:443" 的端口被 URL 规范化擦除
 *     （port === ""），约束对显式写了默认端口的条目静默失效 ——
 *     实测 http://a.example.com 会被 *.example.com:443 放行。
 */
describe("isAllowedDomain 端口隔离", () => {
  test("泛域名条目显式端口不得放行其他端口", () => {
    assert.equal(isAllowedDomain("https://a.example.com:3000", "*.example.com:3000"), true);
    assert.equal(isAllowedDomain("https://a.example.com:9999", "*.example.com:3000"), false);
  });

  test("精确条目端口隔离", () => {
    assert.equal(isAllowedDomain("http://localhost:3000", "http://localhost:3000"), true);
    assert.equal(isAllowedDomain("http://localhost:9999", "http://localhost:3000"), false);
  });

  test("协议默认端口归一后可匹配，且不跨协议放行", () => {
    assert.equal(isAllowedDomain("https://a.example.com", "*.example.com:443"), true);
    assert.equal(isAllowedDomain("http://a.example.com", "*.example.com:80"), true);
    assert.equal(isAllowedDomain("https://a.example.com", "*.example.com:80"), false);
    // 关键回归点：修复前此处返回 true
    assert.equal(isAllowedDomain("http://a.example.com", "*.example.com:443"), false);
    assert.equal(isAllowedDomain("http://a.example.com", "a.example.com:443"), false);
  });

  test("未指定端口的白名单条目忽略入站端口", () => {
    assert.equal(isAllowedDomain("https://a.example.com:9999", "*.example.com"), true);
    assert.equal(isAllowedDomain("https://music.example.com:8443", "music.example.com"), true);
  });

  test("泛域名仍拒绝后缀伪装", () => {
    assert.equal(isAllowedDomain("https://evil-example.com:3000", "*.example.com:3000"), false);
    assert.equal(isAllowedDomain("https://example.com.evil.tld:3000", "*.example.com:3000"), false);
  });

  test("空配置与非法输入 fail-closed", () => {
    assert.equal(isAllowedDomain("https://a.example.com", ""), false);
    assert.equal(isAllowedDomain(undefined, "music.example.com"), false);
    assert.equal(isAllowedDomain("::::not a url", "music.example.com"), false);
  });
});

/**
 * 回归：sanitizeUrl 必须覆盖 pathname 与解析失败分支。
 *
 * 历史缺陷：只遍历 searchParams，而 new URL() 对 "http://h/;token=SECRET" 这类
 * 无 "?" 的输入仍然解析成功，凭据落在 pathname；解析失败时更是直接返回原串。
 */
describe("sanitizeUrl", () => {
  test("常规敏感参数被脱敏", () => {
    const out = sanitizeUrl("https://h/p?token=SECRET&id=1");
    assert.ok(!out.includes("SECRET"), `泄露明文: ${out}`);
    assert.ok(out.includes("id=1"));
  });

  test("pathname 形态的凭据被脱敏", () => {
    const out = sanitizeUrl("http://h/;token=SECRET");
    assert.ok(!out.includes("SECRET"), `泄露明文: ${out}`);
  });

  test("相对路径形态同样脱敏", () => {
    const out = sanitizeUrl("/;token=SECRET");
    assert.ok(!out.includes("SECRET"), `泄露明文: ${out}`);
  });

  test("普通 URL 与空值不被破坏", () => {
    assert.equal(sanitizeUrl("https://music.example.com/player"), "https://music.example.com/player");
    assert.equal(sanitizeUrl(""), "");
    assert.equal(sanitizeUrl("/match?id=1"), "/match?id=1");
  });
});
