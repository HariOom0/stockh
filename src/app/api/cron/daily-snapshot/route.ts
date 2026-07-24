import { NextResponse } from "next/server";
import { isMarketClosed, getTradingDate } from "@/lib/trading-calendar";

// Vercel Cron: 7:15 PM IST daily (Mon-Fri)
// Scrapes live data from Chartink, filters, and saves to DB.
// Falls back to static file if scrape fails.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  if (isMarketClosed(istDate)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `${istDate} is not a trading day` });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const tradingDate = getTradingDate();

  try {
    // Call volume-shockers which tries live scrape → filter → save to DB
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/volume-shockers`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const data = await res.json();

    return NextResponse.json({
      ok: !!data.stocks?.length,
      tradingDate,
      stockCount: data.stocks?.length || 0,
      source: data.source || "unknown",
    });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
