'use client';

import { useState, useEffect } from 'react';

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

export default function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsageStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/usage');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch usage stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsageStats();
    // Refresh every 5 seconds
    const interval = setInterval(fetchUsageStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading usage stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong className="font-bold">Error:</strong>
            <span className="block sm:inline"> {error}</span>
          </div>
          <button 
            onClick={fetchUsageStats}
            className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const isRateLimited = stats.rateLimitStatus.currentRequests >= stats.rateLimitStatus.maxRequests;
  const nextAvailableInSeconds = Math.ceil(stats.rateLimitStatus.nextAvailableSlot / 1000);

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">eBay API Usage Monitor</h1>
          
          {/* Rate Limiting Status */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Rate Limiting Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg ${isRateLimited ? 'bg-red-100 border border-red-300' : 'bg-green-100 border border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Current Requests</span>
                  <span className={`text-2xl font-bold ${isRateLimited ? 'text-red-600' : 'text-green-600'}`}>
                    {stats.rateLimitStatus.currentRequests}/{stats.rateLimitStatus.maxRequests}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {isRateLimited ? 'Rate limit reached' : 'Within limits'}
                </p>
              </div>
              
              <div className="p-4 rounded-lg bg-blue-100 border border-blue-300">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Window Size</span>
                  <span className="text-2xl font-bold text-blue-600">
                    {stats.rateLimitStatus.windowMs / 1000}s
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {stats.rateLimitStatus.nextAvailableSlot > 0 
                    ? `Next call in ${nextAvailableInSeconds}s`
                    : 'Ready for next call'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Cache Statistics */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Cache Statistics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-purple-100 border border-purple-300">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Cached Queries</span>
                  <span className="text-2xl font-bold text-purple-600">
                    {stats.cacheStats.totalCachedQueries}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">eBay API results cached</p>
              </div>
              
              <div className="p-4 rounded-lg bg-indigo-100 border border-indigo-300">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Unique OCR Texts</span>
                  <span className="text-2xl font-bold text-indigo-600">
                    {stats.cacheStats.ocrTextEntries}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">Different cards processed</p>
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Recommendations</h2>
            <div className="space-y-2">
              {stats.recommendations.map((rec, index) => (
                <div key={index} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-gray-700">{rec}</p>
                </div>
              ))}
            </div>
          </div>

          {/* API Limits Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-700 mb-2">eBay API Limits</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <p>• Daily limit: 5,000 calls per day</p>
              <p>• Current rate: 1 call every 5 seconds (12 calls/minute)</p>
              <p>• Daily capacity: ~17,280 calls (well under limit)</p>
              <p>• Reset time: Every 24 hours at midnight UTC</p>
            </div>
          </div>

          <div className="mt-6 text-center">
            <button 
              onClick={fetchUsageStats}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Refresh Stats
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
