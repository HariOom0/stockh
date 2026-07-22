import { NextResponse } from "next/server";
import { fetchVolumeShockers } from "@/lib/scraper";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
 * Check if DATABASE_URL looks like a valid PostgreSQL connection string.
 * A dummy value like "file:/..." would pass a truthy check but crash Prisma.
 */
function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/**
 * Safely load Prisma DB client. Returns null if DB URL is not configured.
 */
async function getDb() {
  if (!hasValidDbUrl()) return null;
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    console.warn("[VolumeShockers] Failed to load Prisma client");
    return null;
  }
}

/**
 * Build a lightweight fingerprint from a stock list to detect duplicate data.
 */
function fingerprint(stocks: { ticker: string; close: number }[]): string {
  return stocks.map((s) => `${s.ticker}:${s.close}`).join("|");
}

/**
 * Save a snapshot to the DB (fire-and-forget). Silently fails if DB is unavailable.
 */
function saveSnapshotIfNew(stocks: VolumeShockerData[], tradingDate: string) {
  if (!hasValidDbUrl()) return;

  const snapshotPayload = stocks.map((s) => ({
    name: s.name,
    ticker: s.ticker,
    close: s.close,
    change: s.change,
    volGainPct: s.volGainPct,
    isPositive: s.isPositive,
  }));

  import("@/lib/db")
    .then(({ db }) =>
      db.dailyStockSnapshot.upsert({
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
    )
    .then(() =>
      console.log(`[Snapshot] Saved for ${tradingDate}: ${snapshotPayload.length} stocks`)
    )
    .catch((err) => console.error("[Snapshot] Failed to save:", err));
}

export async function GET() {
  const tradingDate = getTradingDate();
  const now = Date.now();

  // 1. Return in-memory cached data if still fresh
  if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
    return NextResponse.json({
      stocks: cachedData.stocks,
      cached: true,
      lastUpdated: cachedData.timestamp,
      tradingDate,
    });
  }

  // 2. Check DB for today's data (skip if DB not configured)
  try {
    const db = await getDb();
    if (db) {
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
    }
  } catch (dbError) {
    console.error("[VolumeShockers] DB read failed (non-fatal):", dbError);
  }

  // 3. Fetch fresh data via Chartink (+ Yahoo for volume averages)
  try {
    const allStocks = await fetchVolumeShockers();

    if (allStocks.length > 0) {
      // 4. Duplicate-data guard (non-trading-day safety net)
      try {
        const db = await getDb();
        if (db) {
          const lastSnapshot = await db.dailyStockSnapshot.findFirst({
            orderBy: { date: "desc" },
            select: { date: true, stocksJson: true },
          });

          if (lastSnapshot) {
            const lastStocks: VolumeShockerData[] = JSON.parse(lastSnapshot.stocksJson);
            if (fingerprint(allStocks) === fingerprint(lastStocks)) {
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
        }
      } catch {
        // Duplicate guard is optional
      }

      // 5. New data — cache, save to DB & return
      cachedData = { stocks: allStocks, timestamp: now, tradingDate };
      saveSnapshotIfNew(allStocks, tradingDate);

      return NextResponse.json({
        stocks: allStocks,
        cached: false,
        lastUpdated: now,
        tradingDate,
      });
    }
  } catch (scrapeError) {
    console.error("[VolumeShockers] Scraping failed:", scrapeError);
  }

  // 6. Fallback: return most recent data from DB
  try {
    const db = await getDb();
    if (db) {
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
    }
  } catch (dbError) {
    console.error("[VolumeShockers] DB fallback also failed:", dbError);
  }

  // 7. Nothing at all — return empty with helpful message
  return NextResponse.json(
    {
      error: "No data available yet. Stock data is fetched every trading day after market hours (7:15 PM IST). If the market is open, data will appear here after close.",
      stocks: [],
      cached: false,
      tradingDate,
    },
    { status: 503 }
  );
}
