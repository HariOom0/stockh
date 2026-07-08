import { NextRequest, NextResponse } from "next/server";
import { fetchStockDetail } from "@/lib/scraper";

// In-memory cache per ticker
const cache = new Map<
  string,
  {
    data: Awaited<ReturnType<typeof fetchStockDetail>>;
    timestamp: number;
  }
>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");

  if (!ticker || !/^[A-Z0-9]{1,15}$/.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid or missing ticker parameter" },
      { status: 400 }
    );
  }

  try {
    const now = Date.now();
    const cached = cache.get(ticker);

    if (cached && now - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cached.data, cached: true });
    }

    const detail = await fetchStockDetail(ticker.toUpperCase());
    cache.set(ticker, { data: detail, timestamp: now });

    return NextResponse.json({ ...detail, cached: false });
  } catch (error) {
    console.error(`Error fetching detail for ${ticker}:`, error);
    return NextResponse.json(
      {
        error: `Failed to fetch data for ${ticker}. The stock may not exist on Screener.in or the site is temporarily unavailable.`,
      },
      { status: 503 }
    );
  }
}