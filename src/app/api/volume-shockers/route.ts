import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";
import { db } from "@/lib/db";

// In-memory cache
let cachedData: {
  stocks: ReturnType<typeof fetchVolumeShockers> extends Promise<infer T> ? T : never;
  timestamp: number;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "2026-07-08"
}

export async function GET() {
  try {
    const now = Date.now();

    // Return cached data if still fresh, but still save to DB
    if (cachedData && now - cachedData.timestamp < CACHE_TTL) {
      // Ensure today's snapshot is in DB (fire-and-forget)
      const today = getTodayDate();
      const snapshotPayload = cachedData.stocks.map((s) => ({
        name: s.name, ticker: s.ticker, close: s.close,
        change: s.change, volGainPct: s.volGainPct, isPositive: s.isPositive,
      }));
      db.dailyStockSnapshot.upsert({
        where: { date: today },
        update: { stockCount: snapshotPayload.length, stocksJson: JSON.stringify(snapshotPayload) },
        create: { date: today, stockCount: snapshotPayload.length, stocksJson: JSON.stringify(snapshotPayload) },
      }).catch((err) => console.error("Failed to save snapshot:", err));

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

    // Save today's snapshot to DB (fire-and-forget, don't block response)
    const today = getTodayDate();
    const snapshotPayload = filtered.map((s) => ({
      name: s.name,
      ticker: s.ticker,
      close: s.close,
      change: s.change,
      volGainPct: s.volGainPct,
      isPositive: s.isPositive,
    }));

    db.dailyStockSnapshot
      .upsert({
        where: { date: today },
        update: {
          stockCount: snapshotPayload.length,
          stocksJson: JSON.stringify(snapshotPayload),
        },
        create: {
          date: today,
          stockCount: snapshotPayload.length,
          stocksJson: JSON.stringify(snapshotPayload),
        },
      })
      .then(() => console.log(`Snapshot saved for ${today}: ${snapshotPayload.length} stocks`))
      .catch((err) => console.error("Failed to save snapshot:", err));

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