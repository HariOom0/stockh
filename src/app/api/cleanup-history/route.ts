import { NextResponse } from "next/server";
import { isMarketClosed } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

/**
 * POST /api/cleanup-history
 * Deletes any snapshots for non-trading days (weekends, holidays).
 * Call once to clean up bad entries, then the seed will re-fill correct dates.
 */
export async function POST() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    const { db } = await import("@/lib/db");
    const all = await db.dailyStockSnapshot.findMany({ select: { date: true } });

    const toDelete: string[] = [];
    for (const entry of all) {
      if (isMarketClosed(entry.date)) {
        toDelete.push(entry.date);
      }
    }

    if (toDelete.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0, message: "No bad entries" });
    }

    for (const date of toDelete) {
      await db.dailyStockSnapshot.delete({ where: { date } });
    }

    return NextResponse.json({ ok: true, deleted: toDelete.length, deletedDates: toDelete });
  } catch (error: any) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
