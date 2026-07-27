import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Short-lived cache for live polls (5s) to avoid hammering APIs
let liveCached: { stocks: any[]; sectors: any[]; dataSource: string; ts: number } | null = null;
const LIVE_CACHE_TTL = 5_000;

// ─── NSE direct (may be blocked on cloud IPs) ─────────────────────
async function getNSESession(signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("https://www.nseindia.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const cookies = (res.headers.get("set-cookie") || "")
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.length > 0)
      .join("; ");
    return cookies || null;
  } catch {
    return null;
  }
}

async function fetchNSEStocks(cookie: string, tickers: string[], signal: AbortSignal): Promise<any[] | null> {
  try {
    // Try most active by volume - gives us ALL top volume stocks with live data
    const res = await fetch(
      "https://www.nseindia.com/api/live-market-analysis/most-active-securities-by-volume",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Cookie: cookie,
          Referer: "https://www.nseindia.com/market-data/live-market",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal,
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data) || data.length < 3) return null;
    // Build a map from NSE data for quick lookup
    const nseMap: Record<string, any> = {};
    for (const s of data) {
      const sym = String(s.symbol || "").trim();
      nseMap[sym] = s;
    }
    // Return only the requested tickers (which are in the current top 10)
    const results = tickers
      .map((t) => {
        const s = nseMap[t];
        if (!s) return null;
        return {
          ticker: t,
          ltp: parseFloat(s.ltp || s.lastPrice) || 0,
          change: parseFloat(s.change) || 0,
          changePct: parseFloat(s.pChange) || 0,
          volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
          valueCr: parseFloat(s.totalTradedValue) || 0,
        };
      })
      .filter(Boolean);
    return results.length >= 1 ? results : null;
  } catch {
    return null;
  }
}

// ─── Yahoo Finance (fallback, 15-min delayed for IN stocks) ────────
async function fetchYahooLive(symbol: string, signal: AbortSignal) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    signal.addEventListener("abort", () => controller.abort());
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      ticker: symbol.replace(".NS", ""),
      ltp: meta.regularMarketPrice || 0,
      change: (meta.regularMarketPrice || 0) - (meta.chartPreviousClose || 0),
      changePct: meta.chartPreviousClose
        ? (((meta.regularMarketPrice || 0) - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
        : 0,
      volume: meta.regularMarketVolume || 0,
      valueCr: Math.round(
        ((meta.regularMarketPrice || 0) * (meta.regularMarketVolume || 0)) / 10000000 * 100
      ) / 100,
    };
  } catch {
    return null;
  }
}

// ─── Sector data from NSE ────────────────────────────────────────
async function fetchLiveSectors(cookie: string, signal: AbortSignal) {
  if (!cookie) return [];
  try {
    const secRes = await fetch(
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
    if (!secRes.ok) return [];
    const json = await secRes.json();
    const data = json?.data;
    if (!Array.isArray(data)) return [];
    const totalVol = data.reduce(
      (sum: number, s: any) =>
        sum + (parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0),
      0
    );
    return data
      .map((s: any) => ({
        sector: String(s.abbreviation || s.name || ""),
        volume: parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0,
        changePct: parseFloat(s.pChange) || 0,
        advance: parseInt(s.advances || 0, 10),
        decline: parseInt(s.declines || 0, 10),
        volumePct:
          totalVol > 0
            ? (
                ((parseInt(String(s.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0) /
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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tickersRaw = searchParams.get("tickers") || "";
  const tickers = tickersRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const now = Date.now();

  // Return cached live data if very fresh (< 5s)
  if (liveCached && now - liveCached.ts < LIVE_CACHE_TTL) {
    return NextResponse.json({
      stocks: liveCached.stocks,
      sectors: liveCached.sectors,
      dataSource: liveCached.dataSource,
      now: new Date().toISOString(),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    let stocks: any[] = [];
    let sectors: any[] = [];
    let dataSource = "yahoo";

    // 1. Try NSE first (real-time but often blocked from cloud)
    try {
      const cookie = await getNSESession(controller.signal);
      if (cookie) {
        const nseStocks = await fetchNSEStocks(cookie, tickers, controller.signal);
        if (nseStocks && nseStocks.length >= 3) {
          stocks = nseStocks;
          dataSource = "nse";
        }
        // Sectors from NSE
        const sec = await fetchLiveSectors(cookie, controller.signal);
        if (sec.length > 0) sectors = sec;
      }
    } catch {
      // NSE failed, fall through to Yahoo
    }

    // 2. Fallback: Yahoo Finance (15-min delayed for IN stocks)
    if (stocks.length < 3) {
      const stockResults = await Promise.allSettled(
        tickers.map((t) => fetchYahooLive(`${t}.NS`, controller.signal))
      );
      stocks = stockResults
        .filter(
          (r): r is PromiseFulfilledResult<any> =>
            r.status === "fulfilled" && r.value !== null
        )
        .map((r) => r.value);
      dataSource = "yahoo";
    }

    liveCached = { stocks, sectors, dataSource, ts: now };

    return NextResponse.json({
      stocks,
      sectors,
      dataSource,
      now: new Date().toISOString(),
    });
  } catch {
    if (liveCached) {
      return NextResponse.json({
        stocks: liveCached.stocks,
        sectors: liveCached.sectors,
        dataSource: liveCached.dataSource,
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
