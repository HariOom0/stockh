import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

let seeded = false;

/**
 * Seed any missing dates from seed-data.json.
 * Runs on every first call (not just when DB is empty).
 */
async function ensureSeeded() {
  if (seeded || !hasValidDbUrl()) return;
  seeded = true;

  try {
    const { db } = await import("@/lib/db");

    const seedPath = join(process.cwd(), "public", "data", "seed-data.json");
    const raw = readFileSync(seedPath, "utf-8");
    const seedData: Record<string, any[]> = JSON.parse(raw);

    for (const [date, stocks] of Object.entries(seedData)) {
      if (!Array.isArray(stocks) || stocks.length === 0) continue;

      // Check if this date already exists
      const existing = await db.dailyStockSnapshot.findUnique({ where: { date } });
      if (existing) continue;

      await db.dailyStockSnapshot.create({
        data: { date, stockCount: stocks.length, stocksJson: JSON.stringify(stocks) },
      });
      console.log(`[Seed] ${date}: ${stocks.length} stocks`);
    }
  } catch (err: any) {
    console.warn("[Seed] Failed:", err.message);
    seeded = false;
  }
}

// GET /api/stock-history          → list all snapshot dates
// GET /api/stock-history?date=2026-07-24 → get stocks for a specific date
export async function GET(request: Request) {
  if (!hasValidDbUrl()) {
    return NextResponse.json({ error: "Database not configured.", snapshots: [] }, { status: 503 });
  }

  try {
    const { db } = await import("@/lib/db");

    // Seed any missing dates from seed-data.json
    await ensureSeeded();

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (date) {
      const snapshot = await db.dailyStockSnapshot.findUnique({ where: { date } });
      if (!snapshot) {
        return NextResponse.json({ error: "No data for this date" }, { status: 404 });
      }
      const stocks = JSON.parse(snapshot.stocksJson);
      return NextResponse.json({ date: snapshot.date, stockCount: snapshot.stockCount, stocks });
    }

    const snapshots = await db.dailyStockSnapshot.findMany({
      orderBy: { date: "desc" },
      select: { date: true, stockCount: true, createdAt: true },
    });

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return NextResponse.json({ error: "Failed to fetch stock history" }, { status: 500 });
  }
}
