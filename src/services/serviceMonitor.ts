import { MONITOR_CONFIG } from "../config/index.js";
import { sanitizeQuery, sanitizeUrl } from "../utils/utilSecurity.js";

export interface RequestLog {
  id: string;
  timestamp: string;
  timeStr: string;
  method: string;
  path: string;
  fullUrl: string;
  query: Record<string, string>;
  status: number;
  duration: number; // 耗时 (ms)
  ip: string;
  referer: string;
  origin: string;
  userAgent: string;
  clientType: string;
  source: string; // 匹配到的音源
}

export interface RecordLogParams {
  method: string;
  path: string;
  fullUrl: string;
  query: Record<string, string>;
  status: number;
  duration: number;
  ip: string;
  referer: string;
  origin: string;
  userAgent: string;
  source?: string;
}

export interface MonitorStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  avgDuration: number;
  uptime: number;
  topEndpoints: { name: string; count: number }[];
  topCallers: { name: string; count: number }[];
  topSources: { name: string; count: number }[];
  statusCodes: Record<string, number>;
}

class MonitorService {
  private maxLogs: number = MONITOR_CONFIG.DEFAULT_MAX_LOGS;
  // 聚合统计键空间上限：防止攻击者伪造海量 XFF/IP / Referer 键导致统计 Map 慢性内存膨胀
  private maxStatKeys: number = MONITOR_CONFIG.DEFAULT_MAX_STAT_KEYS;
  private logs: RequestLog[] = [];
  private totalRequests: number = 0;
  private successRequests: number = 0;
  private failedRequests: number = 0;
  private totalDuration: number = 0;
  private endpointMap: Map<string, number> = new Map();
  private callerMap: Map<string, number> = new Map();
  private sourceMap: Map<string, number> = new Map();
  private statusMap: Map<string, number> = new Map();
  private startTime: number = Date.now();

  /** 带容量上限的计数器：超出上限时丢弃新键（已有键照常累加），保障 TopN 统计仍有效 */
  private bumpCount(map: Map<string, number>, key: string): void {
    const current = map.get(key);
    if (current !== undefined) {
      map.set(key, current + 1);
      return;
    }
    if (map.size < this.maxStatKeys) {
      map.set(key, 1);
    }
  }

  /**
   * 解析客户端类型
   */
  private parseClientType(ua: string, referer: string): string {
    if (!ua && !referer) return "Direct API";
    const lowerUA = (ua || "").toLowerCase();
    const lowerRef = (referer || "").toLowerCase();

    if (lowerRef.includes("localhost") || lowerRef.includes("127.0.0.1")) {
      return "Local Dev / Web";
    }
    if (lowerUA.includes("home-4") || lowerRef.includes("home")) {
      return "home-4.1.7 播放器";
    }
    if (lowerUA.includes("postman") || lowerUA.includes("apifox") || lowerUA.includes("curl") || lowerUA.includes("insomnia")) {
      return "API 调试工具";
    }
    if (lowerUA.includes("micromessenger") || lowerUA.includes("wechat")) {
      return "微信内置浏览器";
    }
    if (lowerUA.includes("mobile") || lowerUA.includes("android") || lowerUA.includes("iphone")) {
      return "移动端浏览器 / App";
    }
    if (lowerUA.includes("chrome") || lowerUA.includes("safari") || lowerUA.includes("firefox") || lowerUA.includes("edge")) {
      return "桌面端 Web 浏览器";
    }
    return "通用客户端";
  }

  /**
   * 记录一次请求日志 (自动执行敏感数据脱敏)
   */
  record(logData: RecordLogParams): void {
    // 忽略监控自身与静态文件的高频打点（/monitor 为 Serverless 双平台兼容别名路径，同样跳过）
    if (
      logData.path.startsWith("/api/monitor") ||
      logData.path.startsWith("/monitor") ||
      logData.path.endsWith(".png") ||
      logData.path.endsWith(".ico")
    ) {
      return;
    }

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0] || now.toLocaleTimeString();

    let callerName = "Direct API";
    if (logData.referer) {
      try {
        const refUrl = new URL(logData.referer.includes("://") ? logData.referer : `http://${logData.referer}`);
        callerName = `${refUrl.protocol}//${refUrl.host}`;
      } catch {
        callerName = logData.referer.slice(0, 40);
      }
    } else if (logData.origin) {
      callerName = logData.origin;
    } else if (logData.ip) {
      callerName = `IP: ${logData.ip}`;
    }

    const clientType = this.parseClientType(logData.userAgent, logData.referer);
    const audioSource = logData.source || "-";

    const cleanedQuery = sanitizeQuery(logData.query);
    const cleanedUrl = sanitizeUrl(logData.fullUrl);

    const logItem: RequestLog = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now.toISOString(),
      timeStr,
      method: logData.method,
      path: logData.path,
      fullUrl: cleanedUrl,
      query: cleanedQuery,
      status: logData.status,
      duration: logData.duration,
      ip: logData.ip || "127.0.0.1",
      referer: logData.referer || "-",
      origin: logData.origin || "-",
      userAgent: logData.userAgent || "-",
      clientType,
      source: audioSource,
    };

    // 存入环形日志队列
    this.logs.unshift(logItem);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // 累加统计
    this.totalRequests++;
    this.totalDuration += logData.duration;
    if (logData.status >= 200 && logData.status < 400) {
      this.successRequests++;
    } else {
      this.failedRequests++;
    }

    // 统计端点分布
    this.bumpCount(this.endpointMap, logData.path);

    // 统计调用方分布
    this.bumpCount(this.callerMap, callerName);

    // 统计音源命中分布
    if (audioSource && audioSource !== "-") {
      this.bumpCount(this.sourceMap, audioSource);
    }

    // 统计状态码
    this.bumpCount(this.statusMap, String(logData.status || 200));
  }

  /**
   * 获取聚合统计信息
   */
  getStats(): MonitorStats {
    const avgDuration =
      this.totalRequests > 0 ? Math.round(this.totalDuration / this.totalRequests) : 0;
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const topEndpoints = Array.from(this.endpointMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topCallers = Array.from(this.callerMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topSources = Array.from(this.sourceMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const statusCodes: Record<string, number> = {};
    for (const [code, count] of this.statusMap.entries()) {
      statusCodes[code] = count;
    }

    return {
      totalRequests: this.totalRequests,
      successRequests: this.successRequests,
      failedRequests: this.failedRequests,
      avgDuration,
      uptime,
      topEndpoints,
      topCallers,
      topSources,
      statusCodes,
    };
  }

  /**
   * 分页与关键词检索日志
   */
  getData(params: {
    page: number;
    limit: number;
    path?: string;
    status?: string;
    keyword?: string;
  }) {
    const { page, limit, path, status, keyword } = params;

    let filtered = this.logs;

    if (path) {
      filtered = filtered.filter((l) => l.path.toLowerCase().includes(path.toLowerCase()));
    }

    if (status) {
      const statusCode = parseInt(status, 10);
      if (!isNaN(statusCode)) {
        filtered = filtered.filter((l) => l.status === statusCode);
      }
    }

    if (keyword) {
      const lower = keyword.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.path.toLowerCase().includes(lower) ||
          l.ip.toLowerCase().includes(lower) ||
          l.referer.toLowerCase().includes(lower) ||
          l.userAgent.toLowerCase().includes(lower) ||
          l.source.toLowerCase().includes(lower)
      );
    }

    const totalLogs = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginatedLogs = filtered.slice(startIndex, startIndex + limit);

    return {
      stats: this.getStats(),
      logs: paginatedLogs,
      totalLogs,
      currentPage: page,
      totalPages: Math.ceil(totalLogs / limit) || 1,
    };
  }

  /**
   * 清空所有请求日志与统计计数
   */
  clear(): void {
    this.logs = [];
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.totalDuration = 0;
    this.endpointMap.clear();
    this.callerMap.clear();
    this.sourceMap.clear();
    this.statusMap.clear();
  }
}

export const monitorService = new MonitorService();
