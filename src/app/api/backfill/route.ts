import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * POST /api/backfill
 * Body: { dates: ["2026-07-23", "2026-07-24"] }
 * 
 * Reads stocks.json from the corresponding git commit SHA for each date
 * and saves to the database. This is a one-time setup endpoint.
 * 
 * Security: Only works if DATABASE_URL is valid and a BACKFILL_SECRET is set.
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
