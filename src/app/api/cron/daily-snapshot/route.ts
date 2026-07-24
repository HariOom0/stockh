import { NextResponse } from "next/server";
import { isMarketClosed, getTradingDate } from "@/lib/trading-calendar";

// Vercel Cron: hits this endpoint daily at 7:15 PM IST (13:45 UTC)
// Skips weekends and NSE holidays.
// Saves today's stock data to the database (from whatever source volume-shockers uses).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (isMarketClosed(istDate)) {
    return NextResponse.json({
      ok: true, skipped: true,
      reason: `${istDate} is not a trading day`,
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const tradingDate = getTradingDate();

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // Call volume-shockers which auto-saves to DB
    const res = await fetch(`${baseUrl}/api/volume-shockers`, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();

    if (!res.ok || !data.stocks || data.stocks.length === 0) {
      return NextResponse.json({
        ok: false, tradingDate,
        error: "No stocks available",
        detail: data.error,
      }, { status: 502 });
    }

    // Double-check: explicitly save to DB if not already saved
    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: data.stocks.length, stocksJson: JSON.stringify(data.stocks) },
      create: { date: tradingDate, stockCount: data.stocks.length, stocksJson: JSON.stringify(data.stocks) },
    });

    return NextResponse.json({
      ok: true, tradingDate,
      stockCount: data.stocks.length,
      saved: true,
    });
  } catch (error) {
    console.error("[Cron] Daily snapshot failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to save snapshot", detail: String(error) },
      { status: 500 }
    );
  }
}
