import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";
import { db } from "@/lib/db";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // Vercel: extend timeout for slow Chartink scraping

// In-memory cache
let cachedData: {
  stocks: VolumeShockerData[];
  timestamp: number;
  tradingDate: string;
} | null = null;

type VolumeShockerData = {
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
};

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Build a lightweight fingerprint from a stock list so we can detect
 * whether Chartink returned the exact same data as the last saved snapshot
 * (which happens on non-trading days / holidays).
 */
function fingerprint(stocks: { ticker: string; close: number }[]): string {
  return stocks.map((s) => `${s.ticker}:${s.close}`).join("|");
}

/**
 * Save a snapshot to the DB, but ONLY if no entry already exists for
 * this trading date.
 */
function saveSnapshotIfNew(stocks: VolumeShockerData[], tradingDate: string) {
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
  const tradingDate = getTradingDate();
  const now = Date.now();

  // ── 1. Return in-memory cached data if still fresh ──────────────────
  if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
    return NextResponse.json({
      stocks: cachedData.stocks,
      cached: true,
      lastUpdated: cachedData.timestamp,
      tradingDate,
    });
  }

  try {
    // ── 2. Check if DB already has data for this trading date ─────────
    const existing = await db.dailyStockSnapshot.findUnique({
      where: { date: tradingDate },
    });

    if (existing) {
      const existingStocks: VolumeShockerData[] = JSON.parse(existing.stocksJson);
      cachedData = { stocks: existingStocks, timestamp: now, tradingDate };
      return NextResponse.json({
        stocks: existingStocks,
        cached: true,
        lastUpdated: now,
        tradingDate: existing.date,
      });
    }

    // ── 3. Try to scrape fresh data from Chartink ─────────────────────
    const allStocks = await fetchVolumeShockers();
    // Filter: positive change AND volume gain > 180%
    const filtered = allStocks.filter(
      (s) => s.isPositive && s.volGainPct >= 180
    );
    filtered.sort((a, b) => b.volGainPct - a.volGainPct);

    if (filtered.length > 0) {
      // ── 4. Duplicate-data guard (non-trading-day safety net) ────────
      const lastSnapshot = await db.dailyStockSnapshot.findFirst({
        orderBy: { date: "desc" },
        select: { date: true, stocksJson: true },
      });

      if (lastSnapshot) {
        const lastStocks: VolumeShockerData[] = JSON.parse(lastSnapshot.stocksJson);
        if (fingerprint(filtered) === fingerprint(lastStocks)) {
          console.log(
            `[VolumeShockers] Data unchanged vs ${lastSnapshot.date} — likely non-trading day.`
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

      // ── 5. New trading-day data — save to DB ────────────────────────
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
    }
  } catch (error) {
    console.error("[VolumeShockers] Scraping failed:", error);
  }

  // ── 6. Fallback: return most recent data from DB ───────────────────
  try {
    const lastSnapshot = await db.dailyStockSnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true, stocksJson: true },
    });

    if (lastSnapshot) {
      const lastStocks: VolumeShockerData[] = JSON.parse(lastSnapshot.stocksJson);
      cachedData = { stocks: lastStocks, timestamp: now, tradingDate: lastSnapshot.date };
      return NextResponse.json({
        stocks: lastStocks,
        cached: true,
        lastUpdated: now,
        tradingDate: lastSnapshot.date,
        usingFallbackDate: lastSnapshot.date,
      });
    }
  } catch (dbError) {
    console.error("[VolumeShockers] DB fallback also failed:", dbError);
  }

  // ── 7. Nothing at all — return empty ────────────────────────────────
  return NextResponse.json(
    {
      error: "No data available. The database has no stock snapshots yet. Please run the daily snapshot cron after market hours.",
      stocks: [],
      cached: false,
      tradingDate,
    },
    { status: 503 }
  );
}