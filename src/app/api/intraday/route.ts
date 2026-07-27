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

/** Top ~35 most liquid NSE stocks (likely highest volume) */
const LIQUID_TICKERS = [
  { sym: "RELIANCE.NS", name: "Reliance Industries" },
  { sym: "HDFCBANK.NS", name: "HDFC Bank" },
  { sym: "ICICIBANK.NS", name: "ICICI Bank" },
  { sym: "TCS.NS", name: "Tata Consultancy" },
  { sym: "INFY.NS", name: "Infosys" },
  { sym: "SBIN.NS", name: "State Bank of India" },
  { sym: "BHARTIARTL.NS", name: "Bharti Airtel" },
  { sym: "ITC.NS", name: "ITC" },
  { sym: "KOTAKBANK.NS", name: "Kotak Mah. Bank" },
  { sym: "LT.NS", name: "Larsen & Toubro" },
  { sym: "AXISBANK.NS", name: "Axis Bank" },
  { sym: "BAJFINANCE.NS", name: "Bajaj Finance" },
  { sym: "TATAMOTORS.NS", name: "Tata Motors" },
  { sym: "MARUTI.NS", name: "Maruti Suzuki" },
  { sym: "TITAN.NS", name: "Titan Company" },
  { sym: "SUNPHARMA.NS", name: "Sun Pharma" },
  { sym: "WIPRO.NS", name: "Wipro" },
  { sym: "HINDUNILVR.NS", name: "Hindustan Unilever" },
  { sym: "ULTRACEMCO.NS", name: "UltraTech Cement" },
  { sym: "NTPC.NS", name: "NTPC" },
  { sym: "POWERGRID.NS", name: "Power Grid Corp" },
  { sym: "TATASTEEL.NS", name: "Tata Steel" },
  { sym: "HCLTECH.NS", name: "HCL Technologies" },
  { sym: "ONGC.NS", name: "ONGC" },
  { sym: "ADANIENT.NS", name: "Adani Enterprises" },
  { sym: "ADANIPORTS.NS", name: "Adani Ports" },
  { sym: "COALINDIA.NS", name: "Coal India" },
  { sym: "BAJAJFINSV.NS", name: "Bajaj Finserv" },
  { sym: "HINDALCO.NS", name: "Hindalco Industries" },
  { sym: "NESTLEIND.NS", name: "Nestle India" },
  { sym: "ASIANPAINT.NS", name: "Asian Paints" },
  { sym: "EICHERMOT.NS", name: "Eicher Motors" },
  { sym: "DRREDDY.NS", name: "Dr. Reddy's Labs" },
];

// ─── Yahoo Finance v8 chart API (works from servers) ────────────
async function fetchYahooChart(symbol: string, signal: AbortSignal): Promise<{
  price: number; change: number; changePct: number; volume: number;
} | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    // Link the parent signal
    signal.addEventListener("abort", () => controller.abort());

    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      price: meta.regularMarketPrice || 0,
      change: (meta.regularMarketPrice || 0) - (meta.chartPreviousClose || 0),
      changePct: meta.chartPreviousClose
        ? (((meta.regularMarketPrice || 0) - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
        : 0,
      volume: meta.regularMarketVolume || 0,
    };
  } catch {
    return null;
  }
}

async function fetchYahooBatch(signal: AbortSignal): Promise<IntraStock[]> {
  const results = await Promise.allSettled(
    LIQUID_TICKERS.map(async (t) => {
      const data = await fetchYahooChart(t.sym, signal);
      if (!data || data.volume <= 0) return null;
      return {
        name: t.name,
        ticker: t.sym.replace(".NS", ""),
        ...data,
        valueCr: Math.round((data.price * data.volume) / 10000000 * 100) / 100,
      };
    })
  );

  const stocks = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value)
    .filter((s) => s.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
    .map((s, i) => ({
      rank: i + 1,
      exchange: "NSE" as const,
      ...s,
    }));

  return stocks;
}

// ─── NSE direct fetch (may be blocked on cloud IPs) ─────────────
async function getNSESession(signal: AbortSignal): Promise<string> {
  const res = await fetch("https://www.nseindia.com", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal,
    redirect: "follow",
  });
  const cookies = res.headers.get("set-cookie") || "";
  return cookies.split(",").map((c) => c.split(";")[0].trim()).filter((c) => c.length > 0).join("; ");
}

async function fetchNSEStocks(cookie: string, signal: AbortSignal): Promise<IntraStock[]> {
  const endpoints = [
    "https://www.nseindia.com/api/live-market-analysis/volume-gainers",
    "https://www.nseindia.com/api/live-market-analysis/most-active-securities-by-value",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Cookie: cookie,
          Referer: "https://www.nseindia.com/market-data/live-market",
        },
        signal,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json?.data;
      if (!Array.isArray(data) || data.length < 3) continue;
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
          ltp: parseFloat(s.ltp || s.lastPrice) || 0,
          change: parseFloat(s.change) || 0,
          changePct: parseFloat(s.pChange) || 0,
          volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
          valueCr: parseFloat(s.totalTradedValue) || 0,
        }));
    } catch {
      continue;
    }
  }
  return [];
}

async function fetchNSSectors(cookie: string, signal: AbortSignal): Promise<SectorData[]> {
  try {
    const res = await fetch(
      "https://www.nseindia.com/api/live-market-analysis/sector-indices-v2",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Cookie: cookie,
          Referer: "https://www.nseindia.com/market-data/live-market",
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
  } catch {
    return [];
  }
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
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    let stocks: IntraStock[] = [];
    let sectors: SectorData[] = [];
    let dataSource = "nse";

    // 1. Try NSE direct (best data but blocked on cloud)
    try {
      const cookie = await getNSESession(controller.signal);
      const [nseStocks, nseSectors] = await Promise.all([
        fetchNSEStocks(cookie, controller.signal),
        fetchNSSectors(cookie, controller.signal),
      ]);
      stocks = nseStocks;
      sectors = nseSectors;
    } catch {
      // NSE failed, will try Yahoo
    }

    // 2. Fallback to Yahoo Finance chart API if NSE returned empty
    if (stocks.length < 3) {
      const yahooStocks = await fetchYahooBatch(controller.signal);
      if (yahooStocks.length >= 3) {
        stocks = yahooStocks;
        dataSource = "yahoo";
      }
    }

    // Normalize sector percentages
    const totalSectorVol = sectors.reduce((sum, s) => sum + s.volume, 0);
    const sectorPct = sectors.slice(0, 12).map((s) => ({
      ...s,
      volumePct: totalSectorVol > 0 ? ((s.volume / totalSectorVol) * 100).toFixed(1) : "0",
    }));

    const data = {
      marketOpen,
      stocks,
      sectors: sectorPct,
      dataSource,
      totalStocksFetched: stocks.length,
    };

    if (stocks.length > 0 || sectorPct.length > 0) {
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
      error: "All data sources failed. Please try again later.",
      cacheTimestamp: now,
      now: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
