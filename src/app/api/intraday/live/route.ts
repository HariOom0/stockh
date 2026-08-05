import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Short-lived cache for live polls (10s)
let liveCached: {
  stocks: any[];
  sectors: any[];
  dataSource: string;
  ts: number;
} | null = null;
const LIVE_CACHE_TTL = 10_000;

const TV_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
};

/** All liquid tickers for the 15-min refresh */
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

export async function GET(req: NextRequest) {
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
    // Fetch ALL liquid tickers + sectors from TradingView (single call each)
    const [stockRes, sectorRes] = await Promise.all([
      fetch("https://scanner.tradingview.com/india/scan", {
        method: "POST",
        headers: TV_HEADERS,
        body: JSON.stringify({
          symbols: { tickers: LIQUID_TICKERS },
          columns: ["description", "close", "change", "change_abs", "volume"],
        }),
        signal: controller.signal,
      }),
      fetch("https://scanner.tradingview.com/india/scan", {
        method: "POST",
        headers: TV_HEADERS,
        body: JSON.stringify({
          symbols: { tickers: SECTOR_SYMBOLS.map((s) => s.symbol) },
          columns: ["description", "close", "change", "change_abs", "volume"],
        }),
        signal: controller.signal,
      }),
    ]);

    // Parse stocks
    let stocks: any[] = [];
    if (stockRes.ok) {
      const stockJson = await stockRes.json();
      if (stockJson.data) {
        stocks = stockJson.data
          .filter((r: any) => r.d && r.d[1] > 0)
          .map((r: any) => {
            const ltp = r.d[1] || 0;
            const changeAbs = r.d[3] || 0;
            const volume = r.d[4] || 0;
            return {
              ticker: (r.s || "").replace("NSE:", ""),
              ltp: Math.round(ltp * 100) / 100,
              change: Math.round(changeAbs * 100) / 100,
              changePct: Math.round((r.d[2] || 0) * 10000) / 10000,
              volume,
              valueCr: Math.round((ltp * volume) / 10000000 * 100) / 100,
            };
          })
          .filter((s: any) => s.volume > 0)
          .sort((a: any, b: any) => b.volume - a.volume)
          .slice(0, 10);
      }
    }

    // Parse sectors
    let sectors: any[] = [];
    if (sectorRes.ok) {
      const secJson = await sectorRes.json();
      if (secJson.data) {
        const tvMap: Record<string, any> = {};
        for (const r of secJson.data) {
          if (r.d && r.d[1] > 0) tvMap[r.s] = r;
        }
        const secResults = SECTOR_SYMBOLS
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
        const totalVol = secResults.reduce(
          (sum: number, s: any) => sum + (s.volume || 0),
          0
        );
        sectors = secResults
          .map((s: any) => ({
            ...s,
            volumePct:
              totalVol > 0
                ? ((s.volume / totalVol) * 100).toFixed(1)
                : "0",
          }))
          .sort((a: any, b: any) => b.volume - a.volume);
      }
    }

    const dataSource = "tradingview";
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
