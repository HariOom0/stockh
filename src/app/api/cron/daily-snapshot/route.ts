import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { isMarketClosed, getTradingDate } from "@/lib/trading-calendar";

// Vercel Cron: 7:15 PM IST daily (Mon-Fri)
// Reads today's stock data from the static file, applies filters, saves to DB.
// No scraping, no external calls — just saves what's already on the site.
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
    return NextResponse.json({ ok: true, skipped: true, reason: `${istDate} is not a trading day` });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const tradingDate = getTradingDate();

  try {
    // Read the static file (same data the site shows)
    const filePath = join(process.cwd(), "public", "data", "stocks.json");
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    if (!data.stocks || !Array.isArray(data.stocks) || data.stocks.length === 0) {
      return NextResponse.json({ ok: false, error: "No stocks in static file" }, { status: 502 });
    }

    // Apply the same filter the site uses: vol > 190% + positive gain
    const filtered = data.stocks
      .filter((s: any) => (Number(s.volGainPct) || 0) > 190 && (Number(s.change) || 0) > 0)
      .map((s: any, i: number) => ({
        sr: i + 1,
        name: String(s.name || ""),
        ticker: String(s.ticker || ""),
        close: Number(s.close) || 0,
        change: Number(s.change) || 0,
        volGainPct: Number(s.volGainPct) || 0,
        isPositive: true,
      }));

    // Save to database
    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: filtered.length, stocksJson: JSON.stringify(filtered) },
      create: { date: tradingDate, stockCount: filtered.length, stocksJson: JSON.stringify(filtered) },
    });

    return NextResponse.json({
      ok: true,
      tradingDate,
      totalInFile: data.stocks.length,
      savedAfterFilter: filtered.length,
    });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
