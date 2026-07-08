import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/stock-history          → list all snapshot dates
// GET /api/stock-history?date=2026-07-08 → get stocks for a specific date
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (date) {
      // Return stocks for a specific date
      const snapshot = await db.dailyStockSnapshot.findUnique({
        where: { date },
      });

      if (!snapshot) {
        return NextResponse.json({ error: "No data for this date" }, { status: 404 });
      }

      const stocks = JSON.parse(snapshot.stocksJson);
      return NextResponse.json({
        date: snapshot.date,
        stockCount: snapshot.stockCount,
        stocks,
      });
    }

    // Return all snapshot dates (newest first)
    const snapshots = await db.dailyStockSnapshot.findMany({
      orderBy: { date: "desc" },
      select: {
        date: true,
        stockCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock history" },
      { status: 500 }
    );
  }
}