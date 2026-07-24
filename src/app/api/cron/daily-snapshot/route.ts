import { NextResponse } from "next/server";
import { isMarketClosed } from "@/lib/trading-calendar";
import { getTradingDate } from "@/lib/trading-calendar";

// Vercel Cron: hits this endpoint daily at 7:15 PM IST (13:45 UTC)
// Skips weekends and NSE holidays.
// Fetches today's stocks and saves a snapshot to the database.
export async function GET(request: Request) {
  // Verify this is a Vercel cron call (Authorization header set by Vercel)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if today is a trading day in IST
  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (isMarketClosed(istDate)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `${istDate} is not a trading day (weekend or holiday)`,
    });
  }

  // Check if DATABASE_URL is a valid PostgreSQL connection string
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({
      ok: false,
      error: "DATABASE_URL not configured or not a valid PostgreSQL URL",
    }, { status: 503 });
  }

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // Fetch today's stocks from the volume-shockers endpoint
    const res = await fetch(`${baseUrl}/api/volume-shockers`, {
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json();

    if (!res.ok || !data.stocks || data.stocks.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No stocks returned from volume-shockers",
        detail: data.error,
      }, { status: 502 });
    }

    // Save snapshot to database
    const { db } = await import("@/lib/db");
    const tradingDate = data.tradingDate || getTradingDate();

    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: {
        stockCount: data.stocks.length,
        stocksJson: JSON.stringify(data.stocks),
      },
      create: {
        date: tradingDate,
        stockCount: data.stocks.length,
        stocksJson: JSON.stringify(data.stocks),
      },
    });

    return NextResponse.json({
      ok: true,
      tradingDate,
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
