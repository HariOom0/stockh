import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { refreshTradingDayCache } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

function hasValidDbUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

let seeded = false;

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

export async function GET(request: Request) {
  if (!hasValidDbUrl()) {
    return NextResponse.json({ error: "Database not configured.", snapshots: [] }, { status: 503 });
  }
  try {
    const { db } = await import("@/lib/db");
    await ensureSeeded();
    // Refresh trading day cache in background (non-blocking)
    refreshTradingDayCache().catch(() => {});
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

export async function DELETE(request: Request) {
  if (!hasValidDbUrl()) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.delete({ where: { date } });
    return NextResponse.json({ ok: true, deleted: date });
  } catch (err: any) {
    if (err.code === "P2025") {
      return NextResponse.json({ error: `No entry for ${date}` }, { status: 404 });
    }
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
