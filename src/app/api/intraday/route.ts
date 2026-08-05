import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cache: only re-fetch every 15 minutes
let cached: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 min

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

/** ~35 most liquid NSE stocks */
const LIQUID_TICKERS = [
  "NSE:RELIANCE", "NSE:HDFCBANK", "NSE:ICICIBANK", "NSE:TCS", "NSE:INFY",
  "NSE:SBIN", "NSE:BHARTIARTL", "NSE:ITC", "NSE:KOTAKBANK", "NSE:LT",
  "NSE:AXISBANK", "NSE:BAJFINANCE", "NSE:TATAMOTORS", "NSE:MARUTI", "NSE:TITAN",
  "NSE:SUNPHARMA", "NSE:WIPRO", "NSE:HINDUNILVR", "NSE:ULTRACEMCO", "NSE:NTPC",
  "NSE:POWERGRID", "NSE:TATASTEEL", "NSE:HCLTECH", "NSE:ONGC",
  "NSE:ADANIENT", "NSE:ADANIPORTS", "NSE:COALINDIA", "NSE:BAJAJFINSV",
  "NSE:HINDALCO", "NSE:NESTLEIND", "NSE:ASIANPAINT", "NSE:EICHERMOT",
  "NSE:DRREDDY", "NSE:TATACONSUM",
];

/** NSE sector index symbols on TradingView */
const SECTOR_SYMBOLS = [
  { symbol: "NSE:BANKNIFTY", name: "Bank" },
  { symbol: "NSE:FINNIFTY", name: "Financial Services" },
  { symbol: "NSE:CNXIT", name: "IT" },
  { symbol: "NSE:CNXPHARMA", name: "Pharma" },
  { symbol: "NSE:CNXAUTO", name: "Auto" },
  { symbol: "NSE:CNXFMCG", name: "FMCG" },
  { symbol: "NSE:CNXMETAL", name: "Metal" },
  { symbol: "NSE:CNXENERGY", name: "Energy" },
  { symbol: "NSE:CNXINFRA", name: "Infrastructure" },
  { symbol: "NSE:CNXMEDIA", name: "Media" },
  { symbol: "NSE:CNXREALTY", name: "Realty" },
  { symbol: "NSE:NIFTYPSUBANK", name: "Pvt Bank" },
];

const TV_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
};

async function fetchTVStocks(signal: AbortSignal): Promise<any[]> {
  const res = await fetch("https://scanner.tradingview.com/india/scan", {
    method: "POST",
    headers: TV_HEADERS,
    body: JSON.stringify({
      symbols: { tickers: LIQUID_TICKERS },
      columns: ["description", "close", "change", "change_abs", "volume"],
    }),
    signal,
  });
  if (!res.ok) return [];
  const json = await res.json();
  if (!json.data) return [];

  return json.data
    .filter((r: any) => r.d && r.d[1] > 0) // must have a valid price
    .map((r: any) => {
      const ltp = r.d[1] || 0;
      const changePct = r.d[2] || 0;
      const changeAbs = r.d[3] || 0;
      const volume = r.d[4] || 0;
      return {
        ticker: (r.s || "").replace("NSE:", ""),
        name: r.d[0] || r.s || "",
        ltp: Math.round(ltp * 100) / 100,
        change: Math.round(changeAbs * 100) / 100,
        changePct: Math.round(changePct * 10000) / 10000,
        volume,
        valueCr: Math.round((ltp * volume) / 10000000 * 100) / 100,
      };
    })
    .filter((s: any) => s.volume > 0)
    .sort((a: any, b: any) => b.volume - a.volume)
    .slice(0, 10)
    .map((s: any, i: number) => ({
      rank: i + 1,
      exchange: "NSE" as const,
      ...s,
    }));
}

async function fetchTVSectors(signal: AbortSignal): Promise<any[]> {
  const tickers = SECTOR_SYMBOLS.map((s) => s.symbol);
  const res = await fetch("https://scanner.tradingview.com/india/scan", {
    method: "POST",
    headers: TV_HEADERS,
    body: JSON.stringify({
      symbols: { tickers },
      columns: ["description", "close", "change", "change_abs", "volume"],
    }),
    signal,
  });
  if (!res.ok) return [];
  const json = await res.json();
  if (!json.data) return [];

  // Build map of symbol -> data
  const tvMap: Record<string, any> = {};
  for (const r of json.data) {
    if (r.d && r.d[1] > 0) tvMap[r.s] = r;
  }

  // Use our known sector names, falling back to TV description
  const results = SECTOR_SYMBOLS
    .map((sec) => {
      const r = tvMap[sec.symbol];
      if (!r) return null;
      return {
        sector: sec.name,
        changePct: Math.round((r.d[2] || 0) * 10000) / 10000,
        volume: r.d[4] || 0,
        advance: 0,
        decline: 0,
        volumePct: "0",
      };
    })
    .filter(Boolean);

  // Calculate volume percentages
  const totalVol = results.reduce((sum: number, s: any) => sum + (s.volume || 0), 0);
  return results
    .map((s: any) => ({
      ...s,
      volumePct: totalVol > 0 ? ((s.volume / totalVol) * 100).toFixed(1) : "0",
    }))
    .sort((a: any, b: any) => b.volume - a.volume);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const [stocks, sectors] = await Promise.all([
      fetchTVStocks(controller.signal),
      fetchTVSectors(controller.signal),
    ]);

    const data = {
      marketOpen,
      stocks,
      sectors,
      dataSource: "tradingview",
      totalStocksFetched: stocks.length,
    };

    if (stocks.length > 0 || sectors.length > 0) {
      cached = { data, timestamp: now };
    }

    return NextResponse.json({
      ...data,
      cached: false,
      cacheTimestamp: now,
      now: new Date().toISOString(),
    });
  } catch (err) {
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
      error: "Data unavailable. Please try again later.",
      cacheTimestamp: now,
      now: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
