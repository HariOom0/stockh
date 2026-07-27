import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cache: only re-fetch every 15 minutes
let cached: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 min

type IntraStock = {
  rank: number;
  name: string;
  ticker: string;
  exchange: "NSE";
  ltp: number;
  change: number;
  changePct: number;
  volume: number;
  valueCr: number;
};

type SectorData = {
  sector: string;
  volume: number;
  changePct: number;
  advance: number;
  decline: number;
  volumePct: string;
};

function isMarketHoursIST(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
  const day = get("weekday");
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  const mins = h * 60 + m;
  if (day === "Sat" || day === "Sun") return false;
  return mins >= 555 && mins <= 930; // 9:15 AM to 3:30 PM IST
}

/** Get session cookies from NSE */
async function getNSESession(signal: AbortSignal): Promise<string> {
  const res = await fetch("https://www.nseindia.com", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
    signal,
    redirect: "follow",
  });
  const cookies = res.headers.get("set-cookie") || "";
  return cookies
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.length > 0)
    .join("; ");
}

/** Try NSE volume gainers endpoint */
async function fetchNSEVolumeGainers(cookie: string, signal: AbortSignal): Promise<IntraStock[]> {
  const res = await fetch(
    "https://www.nseindia.com/api/live-market-analysis/volume-gainers",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: cookie,
        Referer: "https://www.nseindia.com/market-data/live-market",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      signal,
    }
  );
  if (!res.ok) return [];
  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) return [];

  return data.slice(0, 10).map((s: any, i: number) => ({
    rank: i + 1,
    name: String(s.symbol || ""),
    ticker: String(s.symbol || ""),
    exchange: "NSE" as const,
    ltp: parseFloat(s.ltp) || 0,
    change: parseFloat(s.change) || 0,
    changePct: parseFloat(s.pChange) || 0,
    volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
    valueCr: parseFloat(s.totalTradedValue) || 0,
  }));
}

/** Try NSE Nifty 50 constituents sorted by volume */
async function fetchNSENifty50(cookie: string, signal: AbortSignal): Promise<IntraStock[]> {
  const res = await fetch(
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Cookie: cookie,
        Referer: "https://www.nseindia.com/market-data/live-equity-market",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      signal,
    }
  );
  if (!res.ok) return [];
  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) return [];

  return data
    .sort(
      (a: any, b: any) =>
        (parseInt(String(b.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0) -
        (parseInt(String(a.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0)
    )
    .slice(0, 10)
    .map((s: any, i: number) => ({
      rank: i + 1,
      name: String(s.symbol || ""),
      ticker: String(s.symbol || ""),
      exchange: "NSE" as const,
      ltp: parseFloat(s.lastPrice) || 0,
      change: parseFloat(s.change) || 0,
      changePct: parseFloat(s.pChange) || 0,
      volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
      valueCr: parseFloat(s.totalTradedValue) || 0,
    }));
}

/** Try NSE most active by value endpoint */
async function fetchNSEMostActive(cookie: string, signal: AbortSignal): Promise<IntraStock[]> {
  const res = await fetch(
    "https://www.nseindia.com/api/live-market-analysis/most-active-securities-by-value",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Cookie: cookie,
        Referer: "https://www.nseindia.com/market-data/live-market",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      signal,
    }
  );
  if (!res.ok) return [];
  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) return [];

  return data.slice(0, 10).map((s: any, i: number) => ({
    rank: i + 1,
    name: String(s.symbol || ""),
    ticker: String(s.symbol || ""),
    exchange: "NSE" as const,
    ltp: parseFloat(s.ltp) || 0,
    change: parseFloat(s.change) || 0,
    changePct: parseFloat(s.pChange) || 0,
    volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
    valueCr: parseFloat(s.totalTradedValue) || 0,
  }));
}

/** Fetch sector indices from NSE */
async function fetchNSSectors(cookie: string, signal: AbortSignal): Promise<SectorData[]> {
  const res = await fetch(
    "https://www.nseindia.com/api/live-market-analysis/sector-indices-v2",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Cookie: cookie,
        Referer: "https://www.nseindia.com/market-data/live-market",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      signal,
    }
  );
  if (!res.ok) return [];
  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((s: any) => ({
      sector: String(s.abbreviation || s.name || ""),
      volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
      changePct: parseFloat(s.pChange) || 0,
      advance: parseInt(s.advances || 0, 10),
      decline: parseInt(s.declines || 0, 10),
      volumePct: "0",
    }))
    .filter((s) => s.volume > 0)
    .sort((a, b) => b.volume - a.volume);
}

export async function GET() {
  const now = Date.now();
  const marketOpen = isMarketHoursIST();

  // Return cached data if fresh
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
      cacheTimestamp: cached.timestamp,
      marketOpen,
      now: new Date().toISOString(),
    });
  }

  // Fetch fresh data
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const cookie = await getNSESession(controller.signal);

    // Try multiple endpoints in parallel for stocks
    const [volumeGainers, nifty50, mostActive, sectors] = await Promise.all([
      fetchNSEVolumeGainers(cookie, controller.signal),
      fetchNSENifty50(cookie, controller.signal),
      fetchNSEMostActive(cookie, controller.signal),
      fetchNSSectors(cookie, controller.signal),
    ]);

    // Pick the best stock data source (prefer volume gainers, then most active, then nifty50)
    let stocks: IntraStock[] = [];
    if (volumeGainers.length >= 3) stocks = volumeGainers;
    else if (mostActive.length >= 3) stocks = mostActive;
    else if (nifty50.length >= 3) stocks = nifty50;

    // Sort by volume descending and take top 10
    stocks.sort((a, b) => b.volume - a.volume);
    const top10 = stocks.slice(0, 10).map((s, i) => ({ ...s, rank: i + 1 }));

    // Sector volume: normalize to percentages
    const totalSectorVol = sectors.reduce((sum, s) => sum + s.volume, 0);
    const sectorPct = sectors.slice(0, 12).map((s) => ({
      ...s,
      volumePct: totalSectorVol > 0 ? ((s.volume / totalSectorVol) * 100).toFixed(1) : "0",
    }));

    const data = {
      marketOpen,
      stocks: top10,
      sectors: sectorPct,
      totalStocksFetched: stocks.length,
    };

    // Only cache if we got meaningful data
    if (top10.length > 0 || sectorPct.length > 0) {
      cached = { data, timestamp: now };
    }

    return NextResponse.json({
      ...data,
      cached: false,
      cacheTimestamp: now,
      now: new Date().toISOString(),
    });
  } catch (err) {
    // If fetch failed but we have stale cache, return it with a flag
    if (cached) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
        stale: true,
        cacheTimestamp: cached.timestamp,
        marketOpen,
        now: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      marketOpen,
      stocks: [],
      sectors: [],
      error: "NSE unreachable from server. This usually resolves during market hours (9:15 AM - 3:30 PM IST).",
      cacheTimestamp: now,
      now: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
