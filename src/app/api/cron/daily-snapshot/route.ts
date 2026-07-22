import { NextResponse } from "next/server";
import { isMarketClosed } from "@/lib/trading-calendar";

// Vercel Cron: hits this endpoint daily at 7:15 PM IST (13:45 UTC)
// Skips weekends and NSE holidays.
// The actual work is done by the volume-shockers endpoint.
export async function GET(request: Request) {
  // Verify this is a Vercel cron call (Authorization header set by Vercel)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if today is a trading day in IST
  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (isMarketClosed(istDate)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `${istDate} is not a trading day (weekend or holiday)`,
    });
  }

  // Trigger the volume-shockers API internally
  // Extend timeout since the Yahoo Finance scan takes ~5s for 168 stocks
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const res = await fetch(`${baseUrl}/api/volume-shockers`, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000), // 60s timeout for Yahoo scan
    });
    const data = await res.json();

    return NextResponse.json({
      ok: res.ok,
      tradingDate: data.tradingDate,
      stockCount: data.stocks?.length ?? 0,
      error: data.error || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to trigger snapshot", detail: String(error) },
      { status: 500 }
    );
  }
}