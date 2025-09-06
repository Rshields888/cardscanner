interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface OcrTextEntry {
  text: string;
  timestamp: number;
  ttl: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private ocrTextCache = new Map<string, OcrTextEntry>();

  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  // Track OCR text to prevent duplicate eBay calls
  setOcrText(text: string, ttlMs: number = 30 * 60 * 1000): void {
    const hash = this.hashText(text);
    this.ocrTextCache.set(hash, {
      text,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  hasOcrText(text: string): boolean {
    const hash = this.hashText(text);
    const entry = this.ocrTextCache.get(hash);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.ocrTextCache.delete(hash);
      return false;
    }

    return true;
  }

  private hashText(text: string): string {
    // Simple hash function for text comparison
    let hash = 0;
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (let i = 0; i < normalizedText.length; i++) {
      const char = normalizedText.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  clear(): void {
    this.cache.clear();
    this.ocrTextCache.clear();
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
    for (const [key, entry] of this.ocrTextCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.ocrTextCache.delete(key);
      }
    }
  }
}

export const cache = new MemoryCache();

// Clean up expired entries every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => cache.cleanup(), 10 * 60 * 1000);
}
