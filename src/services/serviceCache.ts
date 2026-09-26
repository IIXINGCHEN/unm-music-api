import { env } from "../config/index.js";

export interface CacheOptions {
  max?: number;
  ttl?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 泛型高性能 LRU 内存缓存（支持 TTL 与容量上限淘汰）
 */
export class LRUCache<T = unknown> {
  private max: number;
  private defaultTTL: number;
  private cache: Map<string, CacheEntry<T>>;
  // single-flight：在途请求去重。同一 key 的并发请求共享同一个 promise，
  // 避免缓存击穿时 N 个请求各自触发一整套上游级联（雷鸣群）。
  private inflight: Map<string, Promise<unknown>> = new Map();
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: CacheOptions = {}) {
    this.max = options.max ?? env.CACHE_MAX_SIZE;
    this.defaultTTL = options.ttl ?? env.CACHE_TTL_AUDIO;
    this.cache = new Map();
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }
    const now = Date.now();
    if (now > item.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    // 刷新访问顺序（LRU）
    this.cache.delete(key);
    this.cache.set(key, item);
    this.hits++;
    return item.value;
  }

  set(key: string, value: T, ttl: number = this.defaultTTL): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      // 淘汰最久未使用的项（Map 首个 key）
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  has(key: string): boolean {
    // 不经过 get()：避免污染 hits/misses 命中率统计
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * single-flight 取值：若同一 key 已有在途请求，直接复用其 promise；
   * 否则执行 fn，settled 后从在途表删除。
   * 约定：缓存写入仍由调用方在 fn 内完成（成功才 set）；
   * fn 抛错时不写入缓存，但必须删除在途记录以便后续重试。
   */
  async getOrFetch<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<R>;
    }
    const pending = (async (): Promise<R> => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, pending);
    return pending;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { size: number; max: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      max: this.max,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(2)}%` : "0.00%",
    };
  }
}

export const globalCache = new LRUCache<unknown>({
  max: env.CACHE_MAX_SIZE,
  ttl: env.CACHE_TTL_AUDIO,
});
