import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";

// In-memory cache
let cachedData: {
  stocks: ReturnType<typeof fetchVolumeShockers> extends Promise<infer T> ? T : never;
  timestamp: number;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET() {
  try {
    const now = Date.now();

    // Return cached data if still fresh
    if (cachedData && now - cachedData.timestamp < CACHE_TTL) {
      return NextResponse.json({
        stocks: cachedData.stocks,
        cached: true,
        lastUpdated: cachedData.timestamp,
      });
    }

    const allStocks = await fetchVolumeShockers();
    // Filter: positive change AND volume gain > 180%
    const filtered = allStocks.filter(
      (s) => s.isPositive && s.volGainPct >= 180
    );

    // Sort by volume gain descending
    filtered.sort((a, b) => b.volGainPct - a.volGainPct);

    cachedData = { stocks: filtered, timestamp: now };

    return NextResponse.json({
      stocks: filtered,
      cached: false,
      lastUpdated: now,
      totalOnChartink: allStocks.length,
      filteredCount: filtered.length,
    });
  } catch (error) {
    console.error("Error fetching volume shockers:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch volume shockers. The source site may be temporarily unavailable.",
        stocks: cachedData?.stocks || [],
        cached: true,
      },
      { status: 503 }
    );
  }
}