import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";
import { db } from "@/lib/db";

// In-memory cache
let cachedData: {
  stocks: ReturnType<typeof fetchVolumeShockers> extends Promise<infer T> ? T : never;
  timestamp: number;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Get the actual trading date for the EOD data (YYYY-MM-DD format).
 * Chartink EOD data is from the previous trading day if current IST time
 * is before 7:00 PM (data updates after market close + processing delay).
 * After 7 PM IST, data is from today's trading session.
 */
function getTradingDate(): string {
  const now = new Date();

  // Format as YYYY-MM-DD in IST using Intl
  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Get current IST hour to decide if we need previous day
  const istHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );

  // Before 7 PM IST → data is from previous trading day
  if (istHour < 19) {
    const d = new Date(istDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  return istDate;
}

function saveSnapshot(stocks: typeof cachedData extends { stocks: infer T } | null ? T : never) {
  const tradingDate = getTradingDate();
  const snapshotPayload = stocks.map((s) => ({
    name: s.name, ticker: s.ticker, close: s.close,
    change: s.change, volGainPct: s.volGainPct, isPositive: s.isPositive,
  }));

  db.dailyStockSnapshot.upsert({
    where: { date: tradingDate },
    update: { stockCount: snapshotPayload.length, stocksJson: JSON.stringify(snapshotPayload) },
    create: { date: tradingDate, stockCount: snapshotPayload.length, stocksJson: JSON.stringify(snapshotPayload) },
  })
    .then(() => console.log(`Snapshot saved for ${tradingDate}: ${snapshotPayload.length} stocks`))
    .catch((err) => console.error("Failed to save snapshot:", err));
}

export async function GET() {
  try {
    const now = Date.now();

    // Return cached data if still fresh, but still save to DB
    if (cachedData && now - cachedData.timestamp < CACHE_TTL) {
      saveSnapshot(cachedData.stocks);

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

    // Save snapshot to DB (fire-and-forget)
    saveSnapshot(filtered);

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