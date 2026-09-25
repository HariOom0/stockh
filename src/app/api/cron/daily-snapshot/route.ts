import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { isMarketClosedAsync, getTradingDate, refreshTradingDayCache } from "@/lib/trading-calendar";
import { fetchICStocks, fetchVolumeShockers } from "@/lib/scraper";

export const dynamic = "force-dynamic";

function isAfter9PMIST(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour > 21 || (hour === 21 && minute >= 0);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !secret || request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAfter9PMIST()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Before 9:00 PM IST" });
  }

  await refreshTradingDayCache();
  const tradingDate = getTradingDate();
  if (await isMarketClosedAsync(tradingDate)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Trading date ${tradingDate} is not a trading day` });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://") && !dbUrl.startsWith("file:"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    const scraped = await fetchVolumeShockers();
    let stocks = scraped.filter((stock) => stock.volGainPct > 190 && stock.change > 0).map((stock, index) => ({ ...stock, sr: index + 1 }));
    let icStocks = await fetchICStocks(scraped);

    if (!stocks.length || !icStocks.length) {
      try {
        const raw = readFileSync(join(process.cwd(), "public", "data", "stocks.json"), "utf-8");
        const fallback = JSON.parse(raw);
        if (fallback.tradingDate === tradingDate) {
          if (!stocks.length && Array.isArray(fallback.stocks)) stocks = fallback.stocks;
          if (!icStocks.length && Array.isArray(fallback.icStocks)) icStocks = fallback.icStocks;
        }
      } catch (fallbackError) {
        console.error("[Cron] Bundled fallback failed:", fallbackError);
      }
    }

    if (!stocks.length) return NextResponse.json({ ok: false, error: "No stocks returned from scraper" }, { status: 502 });
    if (!icStocks.length) return NextResponse.json({ ok: false, error: "IC scan returned no stocks" }, { status: 502 });

    const { db } = await import("@/lib/db");
    const stocksJson = JSON.stringify(stocks);
    const icStocksJson = JSON.stringify(icStocks);
    const latest = await db.dailyStockSnapshot.findFirst({
      where: { NOT: { date: tradingDate } },
      orderBy: { date: "desc" },
      select: { date: true, stocksJson: true, icStocksJson: true },
    });
    if (latest && latest.stocksJson === stocksJson) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Identical dataset already saved", tradingDate, duplicateOf: latest.date, stockCount: stocks.length, icStockCount: icStocks.length });
    }

    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: stocks.length, stocksJson, icStockCount: icStocks.length, icStocksJson },
      create: { date: tradingDate, stockCount: stocks.length, stocksJson, icStockCount: icStocks.length, icStocksJson },
    });

    console.log(`[Cron] Saved ${stocks.length} stocks and ${icStocks.length} IC stocks for ${tradingDate}`);
    return NextResponse.json({ ok: true, tradingDate, stockCount: stocks.length, icStockCount: icStocks.length, source: scraped.length > 0 ? "live" : "static" });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
