import { NextResponse } from "next/server";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const INDEX_SYMBOLS = [
  { symbol: "NSE:NIFTY", name: "Nifty 50" },
  { symbol: "BSE:SENSEX", name: "Sensex" },
  { symbol: "NSE:BANKNIFTY", name: "Bank Nifty" },
  { symbol: "NSE:NIFTYIT", name: "Nifty IT" },
  { symbol: "NSE:NIFTYNEXT50", name: "Nifty Next 50" },
  { symbol: "NSE:NIFTYMIDCAP100", name: "Nifty Midcap 100" },
  { symbol: "NSE:NIFTY100", name: "Nifty 100" },
  { symbol: "NSE:NIFTYPSUBANK", name: "Nifty Pvt Bank" },
  { symbol: "NSE:FINNIFTY", name: "Fin Nifty" },
  { symbol: "NSE:NIFTYFMCG", name: "Nifty FMCG" },
  { symbol: "NSE:NIFTYPHARMA", name: "Nifty Pharma" },
  { symbol: "NSE:NIFTYAUTO", name: "Nifty Auto" },
  { symbol: "NSE:NIFTYMETAL", name: "Nifty Metal" },
  { symbol: "NSE:NIFTYREALTY", name: "Nifty Realty" },
  { symbol: "NSE:NIFTYENERGY", name: "Nifty Energy" },
  { symbol: "NSE:NIFTYINFRA", name: "Nifty Infra" },
  { symbol: "NSE:NIFTYMEDIA", name: "Nifty Media" },
  { symbol: "NSE:NIFTYRELIANCE", name: "Nifty Reliance" },
];

// In-memory cache
let cachedData: { indices: IndexData[]; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes during market hours

interface IndexData {
  name: string;
  symbol: string;
  lastPrice: number;
  changePct: number;
  changeAbs: number;
  recommendation: string;
  volume: number | null;
}

function recommendationLabel(val: number): string {
  if (val <= -0.5) return "Strong Sell";
  if (val <= -0.1) return "Sell";
  if (val < 0.1) return "Neutral";
  if (val < 0.5) return "Buy";
  return "Strong Buy";
}

export async function GET() {
  try {
    const now = Date.now();

    if (cachedData && now - cachedData.timestamp < CACHE_TTL) {
      return NextResponse.json({
        indices: cachedData.indices,
        cached: true,
        lastUpdated: cachedData.timestamp,
      });
    }

    const tickers = INDEX_SYMBOLS.map((i) => i.symbol);

    const res = await fetch("https://scanner.tradingview.com/india/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://www.tradingview.com",
      },
      body: JSON.stringify({
        symbols: { tickers },
        columns: [
          "description",
          "close",
          "change",
          "change_abs",
          "Recommend.All",
          "volume",
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`TradingView API returned ${res.status}`);

    const data = await res.json();

    const indices: IndexData[] = [];

    if (data.data) {
      for (let i = 0; i < data.data.length; i++) {
        const row = data.data[i];
        if (!row || !row.d) continue;

        const meta = INDEX_SYMBOLS[i];
        indices.push({
          name: meta?.name || row.d[0] || "",
          symbol: meta?.symbol || row.s || "",
          lastPrice: row.d[1] || 0,
          changePct: row.d[2] || 0,
          changeAbs: row.d[3] || 0,
          recommendation: recommendationLabel(row.d[4] || 0),
          volume: row.d[5] || null,
        });
      }
    }

    cachedData = { indices, timestamp: now };

    return NextResponse.json({
      indices,
      cached: false,
      lastUpdated: now,
    });
  } catch (error) {
    console.error("Error fetching index performance:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch index data",
        indices: cachedData?.indices || [],
        cached: true,
      },
      { status: 503 }
    );
  }
}