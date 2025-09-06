import { okJSON, okEmpty, corsHeaders } from "../_cors";
import { cache } from "@/lib/cache";
import { ebayRateLimiter } from "@/lib/rate-limiter";

export const runtime = "nodejs";

interface UsageStats {
  rateLimitStatus: {
    currentRequests: number;
    maxRequests: number;
    windowMs: number;
    nextAvailableSlot: number;
  };
  cacheStats: {
    totalCachedQueries: number;
    ocrTextEntries: number;
    cacheHitRate: string;
  };
  recommendations: string[];
}

export async function OPTIONS() {
  return okEmpty();
}

export async function GET() {
  try {
    // Get rate limiter status
    const rateLimitStatus = {
      currentRequests: (ebayRateLimiter as any).requests?.length || 0,
      maxRequests: 1,
      windowMs: 5000, // 5 seconds
      nextAvailableSlot: (ebayRateLimiter as any).getRetryAfter?.() || 0
    };

    // Get cache statistics (approximate)
    const cacheStats = {
      totalCachedQueries: (cache as any).cache?.size || 0,
      ocrTextEntries: (cache as any).ocrTextCache?.size || 0,
      cacheHitRate: "N/A" // Would need to track hits/misses
    };

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (rateLimitStatus.currentRequests >= rateLimitStatus.maxRequests) {
      recommendations.push("⚠️ Rate limit reached - wait before making more API calls");
    }
    
    if (rateLimitStatus.nextAvailableSlot > 0) {
      recommendations.push(`⏱️ Next API call available in ${Math.ceil(rateLimitStatus.nextAvailableSlot / 1000)} seconds`);
    }
    
    if (cacheStats.totalCachedQueries > 0) {
      recommendations.push(`✅ ${cacheStats.totalCachedQueries} queries cached - good for performance`);
    }
    
    if (cacheStats.ocrTextEntries > 0) {
      recommendations.push(`🔍 ${cacheStats.ocrTextEntries} unique OCR texts processed`);
    }

    const usageStats: UsageStats = {
      rateLimitStatus,
      cacheStats,
      recommendations
    };

    return okJSON(usageStats);
  } catch (error: any) {
    return new Response(JSON.stringify({ 
      error: error?.message || "Failed to get usage stats" 
    }), { 
      status: 500, 
      headers: { "content-type": "application/json", ...corsHeaders() } 
    });
  }
}
