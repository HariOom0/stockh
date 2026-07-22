import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Check if DATABASE_URL looks like a valid PostgreSQL connection string.
 * A dummy value like "file:/..." would pass a simple truthy check but
 * crash Prisma on initialization.
 */
function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

// GET /api/stock-history          → list all snapshot dates
// GET /api/stock-history?date=2026-07-08 → get stocks for a specific date
export async function GET(request: Request) {
  // Gracefully handle missing/invalid DATABASE_URL
  if (!hasValidDbUrl()) {
    return NextResponse.json(
      { error: "Database not configured. Set a valid DATABASE_URL (postgresql://...) environment variable.", snapshots: [] },
      { status: 503 }
    );
  }

  try {
    const { db } = await import("@/lib/db");
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
      return NextResponse.json(
        {
          date: snapshot.date,
          stockCount: snapshot.stockCount,
          stocks,
        },
        {
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
        }
      );
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

    return NextResponse.json(
      { snapshots },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      }
    );
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock history" },
      { status: 500 }
    );
  }
}
