import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getTradingDate } from "@/lib/trading-calendar";

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

  // 2. Try database (fastest remote source)
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
      console.warn("[VolumeShockers] DB lookup failed:", err.message);
    }
  }

  // 3. Static JSON file (instant, no network)
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
      cachedData = { stocks, timestamp: now, tradingDate: sourceDate };

      // Auto-save today's static data to DB in background (for history)
      if (sourceDate === tradingDate && hasValidDbUrl()) {
        // Don't await — fire and forget, but don't let it block the response
        import("@/lib/db").then(({ db }) =>
          db.dailyStockSnapshot
            .upsert({
              where: { date: tradingDate },
              update: { stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
              create: { date: tradingDate, stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
            })
            .then(() => console.log(`[VolumeShockers] Auto-saved ${stocks.length} stocks for ${tradingDate}`))
            .catch((e: any) => console.warn("[VolumeShockers] Auto-save failed:", e.message))
        );
      }

      return NextResponse.json({
        stocks,
        cached: true,
        lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : now,
        tradingDate: sourceDate,
        source: "static",
      });
    }
  } catch (err: any) {
    console.error("[VolumeShockers] Static file read failed:", err.message);
  }

  // 4. Nothing available
  return NextResponse.json(
    {
      error: "No data available yet.",
      stocks: [],
      cached: false,
      tradingDate,
    },
    { status: 503 }
  );
}
