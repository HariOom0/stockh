import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/backfill
 * Body: { date: "2026-07-24", stocks: [...] }
 * 
 * Saves stock data for a specific date to the database.
 * Called by GitHub Actions daily-scraper workflow.
 * 
 * Auth: CRON_SECRET header or query param required.
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
      return NextResponse.json({ error: "Missing 'date' or 'stocks' in body" }, { status: 400 });
    }

    const { db } = await import("@/lib/db");

    const result = await db.dailyStockSnapshot.upsert({
      where: { date },
      update: {
        stockCount: stocks.length,
        stocksJson: JSON.stringify(stocks),
      },
      create: {
        date,
        stockCount: stocks.length,
        stocksJson: JSON.stringify(stocks),
      },
    });

    return NextResponse.json({
      ok: true,
      date,
      stockCount: stocks.length,
      id: result.id,
    });
  } catch (error: any) {
    console.error("[Backfill] Failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
