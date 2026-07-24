import { NextResponse } from "next/server";
import { isMarketClosed } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

/**
 * POST /api/backfill
 * Body: { date: "2026-07-24", stocks: [...] }
 *
 * Filters stocks (vol > 190% + positive gain) and saves to database.
 * Rejects non-trading days (weekends + NSE holidays).
 */
export async function POST(request: Request) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { stocks, date } = body;

    if (!date || !stocks || !Array.isArray(stocks) || stocks.length === 0) {
      return NextResponse.json({ error: "Missing date or stocks" }, { status: 400 });
    }

    // Reject non-trading days
    if (isMarketClosed(date)) {
      return NextResponse.json({
        ok: false,
        error: `${date} is not a trading day (weekend or NSE holiday)`,
        skipped: true,
      });
    }

    // Apply site filter: volume > 190% AND positive gain
    const filtered = stocks
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

    if (filtered.length === 0) {
      return NextResponse.json({ ok: true, date, stockCount: 0, message: "No stocks passed the filter" });
    }

    const { db } = await import("@/lib/db");
    const result = await db.dailyStockSnapshot.upsert({
      where: { date },
      update: { stockCount: filtered.length, stocksJson: JSON.stringify(filtered) },
      create: { date, stockCount: filtered.length, stocksJson: JSON.stringify(filtered) },
    });

    return NextResponse.json({ ok: true, date, totalReceived: stocks.length, filteredCount: filtered.length, id: result.id });
  } catch (error: any) {
    console.error("[Backfill] Failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
