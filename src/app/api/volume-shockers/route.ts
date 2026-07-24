import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getTradingDate } from "@/lib/trading-calendar";
import { fetchVolumeShockers } from "@/lib/scraper";

export const dynamic = "force-dynamic";

// In-memory cache (survives between invocations on the same server)
let cachedData: {
  stocks: any[];
  timestamp: number;
  tradingDate: string;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

type StockData = {
  sr: number;
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
};

function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

async function saveToDatabase(stocks: StockData[], date: string): Promise<void> {
  if (!hasValidDbUrl()) return;
  try {
    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date },
      update: {
        stockCount: stocks.length,
        stocksJson: JSON.stringify(stocks),
      },
      create: {
        date,
        stockCount: stocks.length,
        stocksJson: JSON.stringify(stocks),
      },
    });
    console.log(`[VolumeShockers] Auto-saved ${stocks.length} stocks for ${date} to database`);
  } catch (err: any) {
    console.warn("[VolumeShockers] Auto-save to DB failed:", err.message);
  }
}

export async function GET() {
  const tradingDate = getTradingDate();
  const now = Date.now();

  // 1. Return in-memory cached data if still fresh
  if (
    cachedData &&
    now - cachedData.timestamp < CACHE_TTL &&
    cachedData.tradingDate === tradingDate
  ) {
    return NextResponse.json({
      stocks: cachedData.stocks,
      cached: true,
      lastUpdated: cachedData.timestamp,
      tradingDate,
    });
  }

  // 2. Try database first (most up-to-date if cron has run today)
  if (hasValidDbUrl()) {
    try {
      const { db } = await import("@/lib/db");
      const snapshot = await db.dailyStockSnapshot.findUnique({
        where: { date: tradingDate },
      });

      if (snapshot) {
        const stocks: StockData[] = JSON.parse(snapshot.stocksJson).map(
          (s: any, i: number) => ({
            sr: i + 1,
            name: String(s.name || ""),
            ticker: String(s.ticker || ""),
            close: Number(s.close) || 0,
            change: Number(s.change) || 0,
            volGainPct: Number(s.volGainPct) || 0,
            isPositive: (Number(s.change) || 0) > 0,
          })
        );

        cachedData = { stocks, timestamp: now, tradingDate };

        return NextResponse.json({
          stocks,
          cached: false,
          lastUpdated: snapshot.createdAt.getTime(),
          tradingDate,
          source: "database",
        });
      }
    } catch (err: any) {
      console.warn("[VolumeShockers] Database lookup failed:", err.message);
    }
  }

  // 3. Try scraping live data first (freshest source)
  try {
    const scraped = await fetchVolumeShockers();
    if (scraped.length > 0) {
      const stocks: StockData[] = scraped.map((s, i) => ({
        sr: i + 1,
        name: s.name,
        ticker: s.ticker,
        close: s.close,
        change: s.change,
        volGainPct: s.volGainPct,
        isPositive: s.isPositive,
      }));

      cachedData = { stocks, timestamp: now, tradingDate };

      // Auto-save to database in background (don't block response)
      saveToDatabase(stocks, tradingDate);

      // Also update static file for fallback
      try {
        const filePath = join(process.cwd(), "public", "data", "stocks.json");
        const payload = {
          stocks: scraped.map(({ sr, ...rest }: any) => rest),
          tradingDate,
          lastUpdated: new Date().toISOString(),
          source: "live_scrape",
        };
        writeFileSync(filePath, JSON.stringify(payload, null, 2));
      } catch {
        // Static file update is best-effort (Vercel is read-only anyway)
      }

      return NextResponse.json({
        stocks,
        cached: false,
        lastUpdated: now,
        tradingDate,
        source: "live_scrape",
      });
    }
  } catch (err: any) {
    console.warn("[VolumeShockers] Live scrape failed:", err.message);
  }

  // 4. Fall back to static JSON file
  try {
    const filePath = join(process.cwd(), "public", "data", "stocks.json");
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    if (data.stocks && Array.isArray(data.stocks) && data.stocks.length > 0) {
      const stocks: StockData[] = data.stocks.map((s: any, i: number) => ({
        sr: i + 1,
        name: String(s.name || ""),
        ticker: String(s.ticker || ""),
        close: Number(s.close) || 0,
        change: Number(s.change) || 0,
        volGainPct: Number(s.volGainPct) || 0,
        isPositive: (Number(s.change) || 0) > 0,
      }));

      const sourceDate = data.tradingDate || tradingDate;

      // Cache in memory
      cachedData = { stocks, timestamp: now, tradingDate: sourceDate };

      // Auto-save static file data to database too (for history)
      if (sourceDate === tradingDate) {
        saveToDatabase(stocks, tradingDate);
      }

      return NextResponse.json({
        stocks,
        cached: true,
        lastUpdated: data.lastUpdated
          ? new Date(data.lastUpdated).getTime()
          : now,
        tradingDate: sourceDate,
        source: "static",
      });
    }
  } catch (err: any) {
    console.error("[VolumeShockers] Static file read failed:", err.message);
  }

  // 5. Nothing available
  return NextResponse.json(
    {
      error:
        "No data available yet. Stock data is updated every trading day after market hours via cron job.",
      stocks: [],
      cached: false,
      tradingDate,
    },
    { status: 503 }
  );
}
