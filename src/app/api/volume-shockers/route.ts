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
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
};

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

  // 2. Read from static JSON file (updated by GitHub Action daily)
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

  // 3. Nothing available
  return NextResponse.json(
    {
      error:
        "No data available yet. Stock data is updated every trading day after market hours (7:15 PM IST) via GitHub Action.",
      stocks: [],
      cached: false,
      tradingDate,
    },
    { status: 503 }
  );
}
