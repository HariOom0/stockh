import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import * as cheerio from "cheerio";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

let cachedData: { stocks: any[]; timestamp: number; tradingDate: string } | null = null;
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
  return !!url && (url.startsWith("postgresql://") || url.startsWith("postgres://"));
}

function applyFilter(stocks: StockData[]): StockData[] {
  return stocks
    .filter((s) => s.volGainPct > 190 && s.change > 0)
    .map((s, i) => ({ ...s, sr: i + 1 }));
}

async function saveToDatabase(stocks: StockData[], date: string): Promise<void> {
  if (!hasValidDbUrl()) return;
  try {
    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date },
      update: { stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
      create: { date, stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
    });
    console.log(`[DB] Saved ${stocks.length} stocks for ${date}`);
  } catch (e: any) {
    console.warn("[DB] Save failed:", e.message);
  }
}

/** Scrape Chartink EOD page using Node.js fetch (5s timeout — fast fail if Cloudflare blocks) */
async function scrapeChartink(): Promise<StockData[]> {
  try {
    const resp = await fetch("https://chartink.com/eodscanner/Volume-Shockers.html", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    if (!html.includes("stocklisttable")) return [];

    const $ = cheerio.load(html);
    const stocks: StockData[] = [];
    $("#stocklisttable tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 6) return;
      const link = cells.eq(1).find("a[href*='/stocks/']");
      if (!link.length) return;
      const href = link.attr("href") || "";
      const m = href.match(/\/stocks\/([A-Z0-9]+)\.html/);
      if (!m) return;
      const close = parseFloat(cells.eq(3).text().trim()) || 0;
      const cm = cells.eq(4).text().trim().match(/([+-]?[\d.]+)%/);
      const vm = cells.eq(5).text().trim().match(/([\d.]+)%/);
      const change = cm ? parseFloat(cm[1]) : 0;
      const volGainPct = vm ? parseFloat(vm[1]) : 0;
      if (close > 0) {
        stocks.push({
          sr: 0, ticker: m[1],
          name: link.text().trim().replace(/\s*(Ltd|Limited)\.?\s*$/i, ""),
          close, change, volGainPct, isPositive: change > 0,
        });
      }
    });
    stocks.forEach((s, i) => (s.sr = i + 1));
    return stocks;
  } catch {
    return [];
  }
}

export async function GET() {
  const tradingDate = getTradingDate();
  const now = Date.now();

  // 1. In-memory cache
  if (cachedData && now - cachedData.timestamp < CACHE_TTL && cachedData.tradingDate === tradingDate) {
    return NextResponse.json({ stocks: cachedData.stocks, cached: true, lastUpdated: cachedData.timestamp, tradingDate });
  }

  // 2. Database (today's already-saved data)
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
      console.warn("[DB] lookup failed:", err.message);
    }
  }

  // 3. Live scrape (8s timeout — won't slow down the site)
  const scraped = await scrapeChartink();
  if (scraped.length > 0) {
    const stocks = applyFilter(scraped);
    cachedData = { stocks, timestamp: now, tradingDate };
    await saveToDatabase(stocks, tradingDate);
    return NextResponse.json({ stocks, cached: false, lastUpdated: now, tradingDate, source: "live" });
  }

  // 4. Static JSON fallback
   try {
    const raw = readFileSync(join(process.cwd(), "public", "data", "stocks.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data.stocks?.length > 0) {
      const allStocks: StockData[] = data.stocks.map((s: any, i: number) => ({
        sr: i + 1, name: String(s.name || ""), ticker: String(s.ticker || ""),
        close: Number(s.close) || 0, change: Number(s.change) || 0,
        volGainPct: Number(s.volGainPct) || 0, isPositive: (Number(s.change) || 0) > 0,
      }));
      const stocks = applyFilter(allStocks);
      const sourceDate = data.tradingDate || tradingDate;
      cachedData = { stocks, timestamp: now, tradingDate: sourceDate };
      if (sourceDate === tradingDate) await saveToDatabase(stocks, tradingDate);
      return NextResponse.json({ stocks, cached: true, lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : now, tradingDate: sourceDate, source: "static" });
    }
  } catch (err: any) {
    console.error("[Static] failed:", err.message);
  }

  return NextResponse.json({ error: "No data available.", stocks: [], cached: false, tradingDate }, { status: 503 });
}
