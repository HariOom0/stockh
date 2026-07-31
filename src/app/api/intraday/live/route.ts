import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Cache ────────────────────────────────────────────────────────
let liveCached: {
  stocks: any[];
  sectors: any[];
  dataSource: string;
  ts: number;
} | null = null;
const LIVE_CACHE_TTL = 10_000; // 10s

// ─── Persistent NSE cookie (reuse across calls to avoid re-session every 10s) ─
let nseCookieCache: { cookie: string; ts: number } | null = null;
const COOKIE_TTL = 5 * 60 * 1000; // cookie valid for 5 min

// ─── NSE session management ──────────────────────────────────────
const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const NSE_API_HEADERS = (cookie: string) => ({
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: cookie,
  Referer: "https://www.nseindia.com/market-data/live-market",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://www.nseindia.com",
});

async function getNSESession(signal: AbortSignal): Promise<string | null> {
  // Reuse cached cookie if still fresh
  if (nseCookieCache && Date.now() - nseCookieCache.ts < COOKIE_TTL) {
    return nseCookieCache.cookie;
  }
  try {
    const res = await fetch("https://www.nseindia.com", {
      headers: NSE_HEADERS,
      signal,
      redirect: "follow",
    });
    if (!res.ok) return nseCookieCache?.cookie || null; // return stale cookie if available
    const cookies = (res.headers.get("set-cookie") || "")
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.length > 0)
      .join("; ");
    if (cookies) {
      nseCookieCache = { cookie: cookies, ts: Date.now() };
      return cookies;
    }
    return nseCookieCache?.cookie || null;
  } catch {
    return nseCookieCache?.cookie || null;
  }
}

// ─── NSE: Fetch top stocks by volume (single API call, gives all data) ──
async function fetchNSEStocks(
  cookie: string,
  requestedTickers: string[],
  signal: AbortSignal
): Promise<{ stocks: any[]; allNSEData: any[] } | null> {
  // Try multiple NSE endpoints for best coverage
  const endpoints = [
    "https://www.nseindia.com/api/live-market-analysis/most-active-securities-by-volume",
    "https://www.nseindia.com/api/live-market-analysis/volume-gainers",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: NSE_API_HEADERS(cookie),
        signal,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json?.data;
      if (!Array.isArray(data) || data.length < 3) continue;

      // Build lookup map from ALL returned NSE stocks
      const nseMap: Record<string, any> = {};
      for (const s of data) {
        const sym = String(s.symbol || "").trim();
        if (sym) nseMap[sym] = s;
      }

      // Match requested tickers against NSE data
      const matchedStocks = requestedTickers
        .map((t) => {
          const s = nseMap[t];
          if (!s) return null;
          return {
            ticker: t,
            ltp: parseFloat(s.ltp || s.lastPrice) || 0,
            change: parseFloat(s.change) || 0,
            changePct: parseFloat(s.pChange) || 0,
            volume:
              parseInt(
                String(s.totalTradedVolume || "0").replace(/,/g, ""),
                10
              ) || 0,
            valueCr: parseFloat(s.totalTradedValue) || 0,
          };
        })
        .filter(Boolean);

      // Also return ALL nse data so we can fallback to top-10 if no match
      const allTopStocks = data
        .sort(
          (a: any, b: any) =>
            (parseInt(String(b.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0) -
            (parseInt(String(a.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0)
        )
        .slice(0, 10)
        .map((s: any, i: number) => ({
          rank: i + 1,
          ticker: String(s.symbol || ""),
          name: String(s.symbol || ""),
          ltp: parseFloat(s.ltp || s.lastPrice) || 0,
          change: parseFloat(s.change) || 0,
          changePct: parseFloat(s.pChange) || 0,
          volume:
            parseInt(
              String(s.totalTradedVolume || "0").replace(/,/g, ""),
              10
            ) || 0,
          valueCr: parseFloat(s.totalTradedValue) || 0,
        }));

      // Return matched if we got at least 1, otherwise fall through to next endpoint
      if (matchedStocks.length > 0) {
        return { stocks: matchedStocks, allNSEData: allTopStocks };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── NSE: Sector data ────────────────────────────────────────────
async function fetchLiveSectors(
  cookie: string,
  signal: AbortSignal
): Promise<any[]> {
  try {
    const res = await fetch(
      "https://www.nseindia.com/api/live-market-analysis/sector-indices-v2",
      {
        headers: NSE_API_HEADERS(cookie),
        signal,
      }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data)) return [];
    const totalVol = data.reduce(
      (sum: number, s: any) =>
        sum +
        (parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0),
      0
    );
    return data
      .map((s: any) => ({
        sector: String(s.abbreviation || s.name || ""),
        volume:
          parseInt(
            String(s.totalTradedVolume || "0").replace(/,/g, ""),
            10
          ) || 0,
        changePct: parseFloat(s.pChange) || 0,
        advance: parseInt(s.advances || 0, 10),
        decline: parseInt(s.declines || 0, 10),
        volumePct:
          totalVol > 0
            ? (
                ((parseInt(
                  String(s.totalTradedVolume || "0").replace(/,/g, ""),
                  10
                ) || 0) /
                  totalVol) *
                100
              ).toFixed(1)
            : "0",
      }))
      .filter((s: any) => s.volume > 0)
      .sort((a: any, b: any) => b.volume - a.volume);
  } catch {
    return [];
  }
}

// ─── GET handler ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tickersRaw = searchParams.get("tickers") || "";
  const tickers = tickersRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const now = Date.now();

  // Return cached live data if very fresh (< 10s)
  if (liveCached && now - liveCached.ts < LIVE_CACHE_TTL) {
    return NextResponse.json({
      stocks: liveCached.stocks,
      sectors: liveCached.sectors,
      dataSource: liveCached.dataSource,
      now: new Date().toISOString(),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    let stocks: any[] = [];
    let sectors: any[] = [];
    let dataSource = "nse";

    // ── NSE Direct: single source of truth ──────────────────────
    const cookie = await getNSESession(controller.signal);

    if (cookie) {
      try {
        // Fetch stocks and sectors in parallel
        const [stockResult, sec] = await Promise.all([
          fetchNSEStocks(cookie, tickers, controller.signal),
          fetchLiveSectors(cookie, controller.signal),
        ]);

        if (stockResult) {
          stocks = stockResult.stocks;
          // If none of the requested tickers matched (e.g. list changed after 15-min refresh),
          // use the full NSE top-10 instead
          if (stocks.length === 0 && stockResult.allNSEData.length > 0) {
            stocks = stockResult.allNSEData;
          }
        }
        if (sec.length > 0) sectors = sec;
      } catch {
        // NSE API call failed
      }
    }

    // ── NO YAHOO FALLBACK ──────────────────────────────────────
    // Yahoo Finance returns inaccurate/delayed data for NSE stocks.
    // If NSE fails, we return stale cached data rather than wrong data.

    if (stocks.length > 0 || sectors.length > 0) {
      liveCached = { stocks, sectors, dataSource, ts: now };
    }

    return NextResponse.json({
      stocks,
      sectors,
      dataSource,
      now: new Date().toISOString(),
    });
  } catch {
    // Return stale cache if available (better than wrong data)
    if (liveCached) {
      return NextResponse.json({
        stocks: liveCached.stocks,
        sectors: liveCached.sectors,
        dataSource: liveCached.dataSource + " (stale)",
        now: new Date().toISOString(),
      });
    }
    return NextResponse.json({
      stocks: [],
      sectors: [],
      dataSource: "none",
      now: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
