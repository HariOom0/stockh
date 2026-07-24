import { NextResponse } from "next/server";
import { isMarketClosed, getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

function isAfter730PMIST(): boolean {
  const now = new Date();
  const istHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  const istMinute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      minute: "numeric",
    }).format(now),
    10
  );
  return istHour > 19 || (istHour === 19 && istMinute >= 30);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAfter730PMIST()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Before 7:30 PM IST" });
  }

  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  if (isMarketClosed(istDate)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `${istDate} is not a trading day` });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const tradingDate = getTradingDate();

  if (isMarketClosed(tradingDate)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Trading date ${tradingDate} is not a trading day` });
  }

  try {
    const { db } = await import("@/lib/db");
    const existing = await db.dailyStockSnapshot.findUnique({ where: { date: tradingDate } });
    if (existing) {
      return NextResponse.json({ ok: true, skipped: true, reason: `Data already exists for ${tradingDate}` });
    }
  } catch {
    // continue
  }

  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/volume-shockers`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const data = await res.json();

    if (!data.stocks?.length) {
      return NextResponse.json({ ok: false, error: "No stocks returned from scraper" });
    }

    const { db } = await import("@/lib/db");
    await db.dailyStockSnapshot.upsert({
      where: { date: tradingDate },
      update: { stockCount: data.stocks.length, stocksJson: JSON.stringify(data.stocks) },
      create: { date: tradingDate, stockCount: data.stocks.length, stocksJson: JSON.stringify(data.stocks) },
    });
    console.log(`[Cron] Saved ${data.stocks.length} stocks for ${tradingDate}`);

    return NextResponse.json({
      ok: true,
      tradingDate,
      stockCount: data.stocks.length,
      source: data.source || "unknown",
    });
  } catch (error) {
    console.error("[Cron] Failed:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
