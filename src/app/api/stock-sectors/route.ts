import { NextRequest, NextResponse } from "next/server";

interface StockSectorInfo {
  ticker: string;
  sector?: string;
  industry?: string;
  name?: string;
}

// In-memory cache
const cache = new Map<string, { data: StockSectorInfo[]; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchSectorForTicker(ticker: string): Promise<StockSectorInfo> {
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const url = `https://www.screener.in/company/${ticker}/`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return { ticker };

  const html = await res.text();

  // Extract sector and industry from the peers section
  let sector: string | undefined;
  let industry: string | undefined;
  let name: string | undefined;

  // Company name
  const nameMatch = html.match(/<h1[^>]*class="h2"[^>]*>([^<]+)/);
  if (nameMatch) name = nameMatch[1].trim();

  // Sector & Industry from peers section a[title] tags
  const sectorMatch = html.match(/title="Sector">([^<]+)/);
  if (sectorMatch) sector = sectorMatch[1].trim();

  const industryMatch = html.match(/title="Industry">([^<]+)/);
  if (industryMatch) industry = industryMatch[1].trim();

  return { ticker, sector, industry, name };
}

// Concurrency-limited parallel fetch
async function fetchWithConcurrency(
  tickers: string[],
  concurrency: number
): Promise<StockSectorInfo[]> {
  const results: StockSectorInfo[] = new Array(tickers.length);
  let index = 0;

  async function worker() {
    while (index < tickers.length) {
      const i = index++;
      if (i >= tickers.length) break;
      try {
        results[i] = await fetchSectorForTicker(tickers[i]);
      } catch {
        results[i] = { ticker: tickers[i] };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tickers.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

export async function GET(req: NextRequest) {
  let tickersParam = req.nextUrl.searchParams.get("tickers");

  // If no tickers provided, auto-use current volume shockers
  if (!tickersParam) {
    try {
      const baseUrl = req.nextUrl.origin;
      const shockRes = await fetch(`${baseUrl}/api/volume-shockers`, {
        signal: AbortSignal.timeout(65_000), // match volume-shockers maxDuration
      });
      if (shockRes.ok) {
        const shockData = await shockRes.json();
        if (shockData.stocks && shockData.stocks.length > 0) {
          tickersParam = shockData.stocks
            .map((s: { ticker: string }) => s.ticker)
            .join(",");
        }
      }
    } catch {
      // Fall through to error below
    }
  }

  if (!tickersParam) {
    return NextResponse.json({ error: "Missing tickers parameter and could not auto-detect from volume shockers" }, { status: 400 });
  }

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z0-9]{1,15}$/.test(t));

  if (tickers.length === 0) {
    return NextResponse.json({ error: "No valid tickers" }, { status: 400 });
  }

  if (tickers.length > 50) {
    return NextResponse.json({ error: "Max 50 tickers per request" }, { status: 400 });
  }

  // Check cache using sorted ticker key
  const cacheKey = tickers.sort().join(",");
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ stocks: cached.data, cached: true });
  }

  try {
    const data = await fetchWithConcurrency(tickers, 3);
    cache.set(cacheKey, { data, timestamp: now });
    return NextResponse.json({ stocks: data, cached: false });
  } catch (error) {
    console.error("Error fetching stock sectors:", error);
    return NextResponse.json(
      { error: "Failed to fetch sector data. Try again later." },
      { status: 503 }
    );
  }
}