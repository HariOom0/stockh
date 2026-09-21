import { NextResponse } from "next/server";
import { isMarketClosedAsync, getTradingDate, refreshTradingDayCache } from "@/lib/trading-calendar";
import { fetchVolumeShockers } from "@/lib/scraper";

export const dynamic = "force-dynamic";

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
    const stocks = scraped
      .filter((stock) => stock.volGainPct > 190 && stock.change > 0)
      .map((stock, index) => ({ ...stock, sr: index + 1 }));

    if (!stocks.length) {
      return NextResponse.json({ ok: false, error: "No stocks returned from scraper" });
    }

    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
      create: { date: tradingDate, stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
    });
    console.log("[Cron] Saved " + stocks.length + " stocks for " + tradingDate);

    return NextResponse.json({
      ok: true,
      tradingDate,
      stockCount: stocks.length,
      source: "live",
    });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
