import type { Context } from "hono";
import { z, type ZodTypeDef } from "zod";
import type { ApiResponse } from "../types/typeApi.js";

/**
 * 构造统一成功响应
 */
export function successResponse<T>(data: T, message: string = "请求成功"): ApiResponse<T> {
  return {
    code: 200,
    message,
    data,
  };
}

/**
 * 构造统一错误响应
 */
export function errorResponse(code: number, message: string): ApiResponse {
  return {
    code,
    message,
  };
}

/**
 * 解析并校验查询参数；失败时返回待回传的 400 响应，成功时返回解析后的数据。
 * 典型用法：
 *   const parsed = parseQuery(c, schema);
 *   if (parsed.err) return parsed.err;
 *   const { id, br } = parsed.data;
 */
export function parseQuery<T>(c: Context, schema: z.ZodType<T, ZodTypeDef, unknown>) {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    return {
      err: c.json(errorResponse(400, parsed.error.issues[0]?.message || "参数不完整"), 400),
      data: null,
    };
  }
  return { err: null, data: parsed.data };
}
