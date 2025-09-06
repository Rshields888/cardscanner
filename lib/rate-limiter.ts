interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterMs: number;
}

class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async checkLimit(): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => time > windowStart);
    
    // Check if we're under the limit
    if (this.requests.length < this.config.maxRequests) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  getRetryAfter(): number {
    if (this.requests.length === 0) return 0;
    const oldestRequest = Math.min(...this.requests);
    return Math.max(0, oldestRequest + this.config.windowMs - Date.now());
  }

  async waitForSlot(): Promise<void> {
    while (!(await this.checkLimit())) {
      const retryAfter = this.getRetryAfter();
      if (retryAfter > 0) {
        await new Promise(resolve => setTimeout(resolve, retryAfter + 100)); // Add 100ms buffer
      }
    }
  }
}

// eBay Finding API rate limits: 5,000 calls per day, ~3.5 calls per minute
// Using 1 request every 5 seconds to be safe but not overly restrictive
export const ebayRateLimiter = new RateLimiter({
  maxRequests: 1,
  windowMs: 5 * 1000, // 5 seconds
  retryAfterMs: 5 * 1000
});
