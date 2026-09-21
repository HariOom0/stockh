import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { isMarketClosedAsync, getTradingDate, refreshTradingDayCache } from "@/lib/trading-calendar";
import { fetchVolumeShockers } from "@/lib/scraper";

export const dynamic = "force-dynamic";

// The scheduled writer is .github/workflows/daily-scrape.yml. This endpoint
// remains available for an explicitly authorized manual recovery run only.

function isAfter7PMIST(): boolean {
  const now = new Date();
  const istHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  const istMinute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      minute: "numeric",
    }).format(now),
    10
  );
  return istHour > 19 || (istHour === 19 && istMinute >= 0);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== "Bearer " + process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAfter7PMIST()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Before 7:00 PM IST" });
  }

  // Refresh TradingView cache to get accurate trading day info
  await refreshTradingDayCache();

  const tradingDate = getTradingDate();

  // Use async TradingView-based check instead of hardcoded holidays
  const closed = await isMarketClosedAsync(tradingDate);
  if (closed) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Trading date " + tradingDate + " is not a trading day (TradingView check)" });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://") && !dbUrl.startsWith("file:"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    // Scrape directly instead of calling the app over HTTP. A Vercel cron
    // invocation may run on a different serverless instance, and the
    // deployment URL is not guaranteed to be reachable from that instance.
    const scraped = await fetchVolumeShockers();
    let stocks = scraped
      .filter((stock) => stock.volGainPct > 190 && stock.change > 0)
      .map((stock, index) => ({ ...stock, sr: index + 1 }));

    // Chartink can block serverless requests. If that happens, persist the
    // bundled dataset only when it belongs to this exact trading date; never
    // write an older snapshot under today's date.
    if (!stocks.length) {
      try {
        const raw = readFileSync(join(process.cwd(), "public", "data", "stocks.json"), "utf-8");
        const fallback = JSON.parse(raw);
        if (fallback.tradingDate === tradingDate && Array.isArray(fallback.stocks)) {
          stocks = fallback.stocks
            .filter((stock: any) => Number(stock.volGainPct) > 190 && Number(stock.change) > 0)
            .map((stock: any, index: number) => ({
              sr: index + 1,
              name: String(stock.name || ""),
              ticker: String(stock.ticker || "").toUpperCase(),
              close: Number(stock.close) || 0,
              change: Number(stock.change) || 0,
              volGainPct: Number(stock.volGainPct) || 0,
              isPositive: true,
            }));
          console.warn(`[Cron] Live scrape unavailable; using bundled ${tradingDate} dataset`);
        }
      } catch (fallbackError) {
        console.error("[Cron] Bundled fallback failed:", fallbackError);
      }
    }

    if (!stocks.length) {
      return NextResponse.json({ ok: false, error: "No stocks returned from scraper" });
    }

    const { db } = await import("@/lib/db");
    const stocksJson = JSON.stringify(stocks);
    const latest = await db.dailyStockSnapshot.findFirst({
      where: { NOT: { date: tradingDate } },
      orderBy: { date: "desc" },
      select: { date: true, stocksJson: true },
    });
    if (latest && latest.stocksJson === stocksJson) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Identical dataset already saved",
        tradingDate,
        duplicateOf: latest.date,
        stockCount: stocks.length,
      });
    }

    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: stocks.length, stocksJson },
      create: { date: tradingDate, stockCount: stocks.length, stocksJson },
    });
    console.log("[Cron] Saved " + stocks.length + " stocks for " + tradingDate);

    return NextResponse.json({
      ok: true,
      tradingDate,
      stockCount: stocks.length,
      source: scraped.length > 0 ? "live" : "static",
    });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
