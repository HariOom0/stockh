import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

let cachedData: {
  stocks: any[];
  timestamp: number;
  tradingDate: string;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000;

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

// Apply the site's filter: volume > 190% AND positive gain
function applyFilter(stocks: StockData[]): StockData[] {
  return stocks
    .filter((s) => s.volGainPct > 190 && s.change > 0)
    .map((s, i) => ({ ...s, sr: i + 1 }));
}

function saveToDatabase(stocks: StockData[], date: string): void {
  if (!hasValidDbUrl()) return;
  import("@/lib/db").then(({ db }) =>
    db.dailyStockSnapshot
      .upsert({
        where: { date },
        update: { stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
        create: { date, stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
      })
      .then(() => console.log(`[DB] Saved ${stocks.length} filtered stocks for ${date}`))
      .catch((e: any) => console.warn("[DB] Save failed:", e.message))
  );
}

export async function GET() {
  const tradingDate = getTradingDate();
  const now = Date.now();

  // 1. In-memory cache
  if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
    return NextResponse.json({ stocks: cachedData.stocks, cached: true, lastUpdated: cachedData.timestamp, tradingDate });
  }

  // 2. Database (returns pre-filtered stocks)
  if (hasValidDbUrl()) {
    try {
      const { db } = await import("@/lib/db");
      const snapshot = await db.dailyStockSnapshot.findUnique({ where: { date: tradingDate } });
      if (snapshot) {
        const stocks: StockData[] = JSON.parse(snapshot.stocksJson);
        cachedData = { stocks, timestamp: now, tradingDate };
        return NextResponse.json({ stocks, cached: false, lastUpdated: snapshot.createdAt.getTime(), tradingDate, source: "database" });
      }
    } catch (err: any) {
      console.warn("[VolumeShockers] DB failed:", err.message);
    }
  }

  // 3. Static JSON file
  try {
    const filePath = join(process.cwd(), "public", "data", "stocks.json");
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    if (data.stocks && Array.isArray(data.stocks) && data.stocks.length > 0) {
      const allStocks: StockData[] = data.stocks.map((s: any, i: number) => ({
        sr: i + 1,
        name: String(s.name || ""),
        ticker: String(s.ticker || ""),
        close: Number(s.close) || 0,
        change: Number(s.change) || 0,
        volGainPct: Number(s.volGainPct) || 0,
        isPositive: (Number(s.change) || 0) > 0,
      }));

      // Apply filter and save filtered stocks to DB
      const stocks = applyFilter(allStocks);
      const sourceDate = data.tradingDate || tradingDate;
      cachedData = { stocks, timestamp: now, tradingDate: sourceDate };

      if (sourceDate === tradingDate) {
        saveToDatabase(stocks, tradingDate);
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
    console.error("[VolumeShockers] Static file failed:", err.message);
  }

  return NextResponse.json({ error: "No data available.", stocks: [], cached: false, tradingDate }, { status: 503 });
}
