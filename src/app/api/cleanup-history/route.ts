import { NextResponse } from "next/server";
import { isMarketClosedAsync, refreshTradingDayCache } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    // Refresh cache from TradingView before cleanup
    await refreshTradingDayCache();

    const { db } = await import("@/lib/db");
    const snapshots = await db.dailyStockSnapshot.findMany({
      select: { date: true },
    });

    const toDelete: string[] = [];
    for (const s of snapshots) {
      const closed = await isMarketClosedAsync(s.date);
      if (closed) {
        toDelete.push(s.date);
      }
    }

    if (toDelete.length === 0) {
      return NextResponse.json({ ok: true, message: "No invalid entries found", deleted: [] });
    }

    await db.dailyStockSnapshot.deleteMany({
      where: { date: { in: toDelete } },
    });

    return NextResponse.json({ ok: true, deleted: toDelete, count: toDelete.length });
  } catch (error: any) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
