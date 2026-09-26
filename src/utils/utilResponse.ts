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
