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
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
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
