import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchVolumeShockers, type VolumeShockerStock } from "@/lib/scraper";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

let cachedData: { stocks: any[]; timestamp: number; tradingDate: string } | null = null;
let scrapeInFlight: Promise<StockData[]> | null = null;
const CACHE_TTL = 30 * 60 * 1000;

type StockData = VolumeShockerStock;

function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  return !!url && (url.startsWith("postgresql://") || url.startsWith("postgres://") || url.startsWith("file:"));
}

function applyFilter(stocks: StockData[]): StockData[] {
  return stocks
    .filter((s) => s.volGainPct > 190 && s.change > 0)
    .map((s, i) => ({ ...s, sr: i + 1 }));
}

function readStaticData(now: number, fallbackDate: string) {
  try {
    const raw = readFileSync(join(process.cwd(), "public", "data", "stocks.json"), "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.stocks) || data.stocks.length === 0) return null;

    const allStocks: StockData[] = data.stocks.map((s: any, i: number) => ({
      sr: i + 1,
      name: String(s.name || ""),
      ticker: String(s.ticker || ""),
      close: Number(s.close) || 0,
      change: Number(s.change) || 0,
      volGainPct: Number(s.volGainPct) || 0,
      isPositive: (Number(s.change) || 0) > 0,
    }));

    return {
      stocks: applyFilter(allStocks),
      date: data.tradingDate || fallbackDate,
      lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : now,
    };
  } catch (err: any) {
    console.error("[Static] failed:", err.message);
    return null;
  }
}

export async function GET() {
  const tradingDate = getTradingDate();
  const now = Date.now();

  // Return cached if still fresh for the same trading date
  if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
    return NextResponse.json({ stocks: cachedData.stocks, cached: true, lastUpdated: cachedData.timestamp, tradingDate });
  }

  // 1. Try live Chartink scrape first (most current data)
  // The page mounts several consumers at once. Collapse concurrent cache
  // misses into one Chartink request rather than hitting the upstream scanner
  // repeatedly while the first response is still in flight.
  if (!scrapeInFlight) {
    scrapeInFlight = fetchVolumeShockers().finally(() => {
      scrapeInFlight = null;
    });
  }
  const scraped = await scrapeInFlight;
  if (scraped.length > 0) {
    const stocks = applyFilter(scraped);
    cachedData = { stocks, timestamp: now, tradingDate };
    return NextResponse.json({ stocks, cached: false, lastUpdated: now, tradingDate, source: "live" });
  }

  // 2. Try DB for the computed trading date
  if (hasValidDbUrl()) {
    try {
      const { db } = await import("@/lib/db");
      const snapshot = await db.dailyStockSnapshot.findUnique({ where: { date: tradingDate } });
      if (snapshot) {
        const stocks: StockData[] = JSON.parse(snapshot.stocksJson);
        cachedData = { stocks, timestamp: now, tradingDate };
        return NextResponse.json({ stocks, cached: false, lastUpdated: snapshot.createdAt.getTime(), tradingDate, source: "database" });
      }

      // 2b. No data for today — choose the newest DB or bundled snapshot.
      // The bundled data can be newer than the last successful cron run.
      const latestSnap = await db.dailyStockSnapshot.findFirst({
        orderBy: { date: "desc" },
        select: { date: true, stocksJson: true, createdAt: true },
      });
      const staticData = readStaticData(now, tradingDate);

      if (staticData && (!latestSnap || staticData.date >= latestSnap.date)) {
        cachedData = { stocks: staticData.stocks, timestamp: now, tradingDate: staticData.date };
        return NextResponse.json({
          stocks: staticData.stocks,
          cached: true,
          lastUpdated: staticData.lastUpdated,
          tradingDate: staticData.date,
          source: "static",
        });
      }

      if (latestSnap) {
        const stocks: StockData[] = JSON.parse(latestSnap.stocksJson);
        cachedData = { stocks, timestamp: now, tradingDate: latestSnap.date };
        return NextResponse.json({
          stocks,
          cached: false,
          lastUpdated: latestSnap.createdAt.getTime(),
          tradingDate: latestSnap.date,
          source: "database",
        });
      }
    } catch (err: any) {
      console.warn("[DB] lookup failed:", err.message);
    }
  }

  // 3. Static fallback (last resort)
  const staticData = readStaticData(now, tradingDate);
  if (staticData) {
    cachedData = { stocks: staticData.stocks, timestamp: now, tradingDate: staticData.date };
    return NextResponse.json({
      stocks: staticData.stocks,
      cached: true,
      lastUpdated: staticData.lastUpdated,
      tradingDate: staticData.date,
      source: "static",
    });
  }

  return NextResponse.json({ error: "No data available.", stocks: [], cached: false, tradingDate }, { status: 503 });
}
