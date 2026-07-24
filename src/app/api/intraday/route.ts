import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cache: only re-fetch every 15 minutes
let cached: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000;

type IntraStock = {
  rank: number;
  name: string;
  ticker: string;
  exchange: "NSE" | "BSE";
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
};

function isMarketHoursIST(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric", minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
  const day = get("weekday");
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  const mins = h * 60 + m;
  if (day === "Sat" || day === "Sun") return false;
  return mins >= 555 && mins <= 930; // 9:15 AM to 3:30 PM
}

/** Try NSE India API with session cookie */
async function fetchNSEVolumeGainers(): Promise<IntraStock[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const sessionResp = await fetch("https://www.nseindia.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const cookies = sessionResp.headers.get("set-cookie") || "";
    const cookieStr = cookies
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .join("; ");

    const res = await fetch(
      "https://www.nseindia.com/api/live-market-analysis/volume-gainers",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookieStr,
          Referer: "https://www.nseindia.com/",
        },
        signal: controller.signal,
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
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Try to get all NSE active stocks sorted by volume */
async function fetchNSEAllByVolume(): Promise<IntraStock[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const sessionResp = await fetch("https://www.nseindia.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const cookies = sessionResp.headers.get("set-cookie") || "";
    const cookieStr = cookies.split(",").map((c) => c.split(";")[0].trim()).join("; ");

    const res = await fetch(
      "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Cookie: cookieStr,
          Referer: "https://www.nseindia.com/",
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data)) return [];

    return data
      .sort((a: any, b: any) => (parseInt(String(b.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0) - (parseInt(String(a.totalTradedVolume || "0").replace(/,/g, ""), 10) || 0))
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
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch sector indices from NSE */
async function fetchNSSectors(): Promise<SectorData[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const sessionResp = await fetch("https://www.nseindia.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const cookies = sessionResp.headers.get("set-cookie") || "";
    const cookieStr = cookies.split(",").map((c) => c.split(";")[0].trim()).join("; ");

    const res = await fetch(
      "https://www.nseindia.com/api/live-market-analysis/sector-indices-v2",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Cookie: cookieStr,
          Referer: "https://www.nseindia.com/",
        },
        signal: controller.signal,
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
      }))
      .filter((s) => s.volume > 0)
      .sort((a, b) => b.volume - a.volume);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
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
      marketOpen,
      now: new Date().toISOString(),
    });
  }

  // Fetch data (even outside market hours — shows last known data)
  const [volumeGainers, allByVolume, sectors] = await Promise.all([
    fetchNSEVolumeGainers(),
    fetchNSEAllByVolume(),
    fetchNSSectors(),
  ]);

  // Use volume gainers if available, else fall back to all-by-volume
  const stocks = volumeGainers.length >= 5 ? volumeGainers : allByVolume;

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

  cached = { data, timestamp: now };

  return NextResponse.json({
    ...data,
    cached: false,
    now: new Date().toISOString(),
  });
}