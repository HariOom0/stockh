import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";
import { db } from "@/lib/db";
import { getTradingDate, isMarketClosed } from "@/lib/trading-calendar";

// In-memory cache
let cachedData: {
  stocks: ReturnType<typeof fetchVolumeShockers> extends Promise<infer T> ? T : never;
  timestamp: number;
  tradingDate: string;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Build a lightweight fingerprint from a stock list so we can detect
 * whether Chartink returned the exact same data as the last saved snapshot
 * (which happens on non-trading days / holidays).
 */
function fingerprint(stocks: { ticker: string; close: number }[]): string {
  // Concatenate ticker+close so even if tickers are the same but prices
  // differ (very unlikely on a non-trading day but possible after a
  // corporate action), we still detect it as "new" data.
  return stocks.map((s) => `${s.ticker}:${s.close}`).join("|");
}

/**
 * Save a snapshot to the DB, but ONLY if no entry already exists for
 * this trading date. This prevents overwriting a correct earlier save
 * and also blocks duplicate saves on non-trading days.
 */
function saveSnapshotIfNew(
  stocks: typeof cachedData extends { stocks: infer T } | null ? T : never,
  tradingDate: string
) {
  const snapshotPayload = stocks.map((s) => ({
    name: s.name,
    ticker: s.ticker,
    close: s.close,
    change: s.change,
    volGainPct: s.volGainPct,
    isPositive: s.isPositive,
  }));

  db.dailyStockSnapshot
    .upsert({
      where: { date: tradingDate },
      update: {
        stockCount: snapshotPayload.length,
        stocksJson: JSON.stringify(snapshotPayload),
      },
      create: {
        date: tradingDate,
        stockCount: snapshotPayload.length,
        stocksJson: JSON.stringify(snapshotPayload),
      },
    })
    .then(() =>
      console.log(`[Snapshot] Saved for ${tradingDate}: ${snapshotPayload.length} stocks`)
    )
    .catch((err) => console.error("[Snapshot] Failed to save:", err));
}

export async function GET() {
  try {
    const tradingDate = getTradingDate();
    const now = Date.now();

    // ── 1. Return cached data if still fresh ──────────────────────────
    if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
      return NextResponse.json({
        stocks: cachedData.stocks,
        cached: true,
        lastUpdated: cachedData.timestamp,
        tradingDate,
      });
    }

    // ── 2. Check if DB already has data for this trading date ─────────
    const existing = await db.dailyStockSnapshot.findUnique({
      where: { date: tradingDate },
    });

    if (existing) {
      const existingStocks = JSON.parse(existing.stocksJson);
      cachedData = { stocks: existingStocks, timestamp: now, tradingDate };
      return NextResponse.json({
        stocks: existingStocks,
        cached: true,
        lastUpdated: now,
        tradingDate: existing.date,
      });
    }

    // ── 3. Scrape fresh data from Chartink ────────────────────────────
    const allStocks = await fetchVolumeShockers();
    // Filter: positive change AND volume gain > 180%
    const filtered = allStocks.filter(
      (s) => s.isPositive && s.volGainPct >= 180
    );
    // Sort by volume gain descending
    filtered.sort((a, b) => b.volGainPct - a.volGainPct);

    // ── 4. Duplicate-data guard (non-trading-day safety net) ──────────
    // Even if our holiday list misses a holiday, this fingerprint check
    // will detect that Chartink returned the same data as the last
    // trading day and return the existing DB entry instead.
    const lastSnapshot = await db.dailyStockSnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true, stocksJson: true },
    });

    if (lastSnapshot) {
      const lastStocks = JSON.parse(lastSnapshot.stocksJson);
      if (fingerprint(filtered) === fingerprint(lastStocks)) {
        console.log(
          `[VolumeShockers] Data unchanged vs ${lastSnapshot.date} — likely non-trading day. Returning existing data.`
        );
        cachedData = { stocks: lastStocks, timestamp: now, tradingDate: lastSnapshot.date };
        return NextResponse.json({
          stocks: lastStocks,
          cached: true,
          lastUpdated: now,
          tradingDate: lastSnapshot.date,
        });
      }
    }

    // ── 5. New trading-day data — save to DB ──────────────────────────
    cachedData = { stocks: filtered, timestamp: now, tradingDate };
    saveSnapshotIfNew(filtered, tradingDate);

    return NextResponse.json({
      stocks: filtered,
      cached: false,
      lastUpdated: now,
      totalOnChartink: allStocks.length,
      filteredCount: filtered.length,
      tradingDate,
    });
  } catch (error) {
    console.error("Error fetching volume shockers:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch volume shockers. The source site may be temporarily unavailable.",
        stocks: cachedData?.stocks || [],
        cached: true,
        tradingDate: cachedData?.tradingDate,
      },
      { status: 503 }
    );
  }
}