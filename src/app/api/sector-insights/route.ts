import { NextResponse } from "next/server";

interface SectorDefinition {
  sector: string;
  symbol: string;
  aliases: string[];
}

interface SectorInsight {
  sector: string;
  symbol: string;
  trend: "Bullish" | "Bearish" | "Neutral" | "Rotating In" | "Rotating Out";
  description: string;
  confidence: "High" | "Medium" | "Low";
  change1D: number;
  change1W: number;
  change1M: number;
  relative1W: number;
  relative1M: number;
  score: number;
  dataDate: string;
}

const SECTORS: SectorDefinition[] = [
  { sector: "Banking & Finance", symbol: "^NSEBANK", aliases: ["bank", "finance", "financial"] },
  { sector: "IT & Technology", symbol: "^CNXIT", aliases: ["it", "technology", "software", "computer"] },
  { sector: "Pharma & Healthcare", symbol: "^CNXPHARMA", aliases: ["pharma", "healthcare", "health"] },
  { sector: "Energy (Oil & Gas)", symbol: "^CNXENERGY", aliases: ["energy", "oil", "gas", "consumable fuels"] },
  { sector: "Auto & Ancillary", symbol: "^CNXAUTO", aliases: ["auto", "automobile", "ancillary"] },
  { sector: "FMCG & Consumer", symbol: "^CNXFMCG", aliases: ["fmcg", "consumer", "food", "tobacco"] },
  { sector: "Infrastructure & Construction", symbol: "^CNXINFRA", aliases: ["infra", "infrastructure", "construction"] },
  { sector: "Metals & Mining", symbol: "^CNXMETAL", aliases: ["metal", "mining", "steel"] },
  { sector: "Realty & Housing", symbol: "^CNXREALTY", aliases: ["realty", "housing", "real estate"] },
  { sector: "Media & Entertainment", symbol: "^CNXMEDIA", aliases: ["media", "entertainment"] },
];

const BENCHMARK = "^NSEI";
const CACHE_TTL = 15 * 60 * 1000;
let cached: { data: SectorInsight[]; timestamp: number } | null = null;

function pct(current: number, previous: number): number {
  return previous ? ((current - previous) / previous) * 100 : 0;
}

async function fetchHistory(symbol: string): Promise<{ values: number[]; dates: string[] }> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Yahoo returned ${response.status} for ${symbol}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  const values: number[] = [];
  const dates: string[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const close = Number(closes[i]);
    if (Number.isFinite(close) && close > 0) {
      values.push(close);
      dates.push(new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10));
    }
  }
  if (values.length < 6) throw new Error(`Insufficient history for ${symbol}`);
  return { values, dates };
}

function trendFor(score: number, relative1W: number, relative1M: number): SectorInsight["trend"] {
  // Sector-relative moves are usually fractions of a percent, so a ±1.5
  // threshold classified nearly everything as Neutral. Use modest thresholds
  // and require the longer-term direction to agree before calling a leader or
  // laggard; conflicting horizons are rotation signals.
  if (relative1W >= 0.1 && relative1M < -0.1) return "Rotating In";
  if (relative1W <= -0.1 && relative1M >= 0.1) return "Rotating Out";
  if (score >= 0.15 && relative1M > 0) return "Bullish";
  if (score <= -0.1 && relative1M < 0) return "Bearish";
  return "Neutral";
}

function descriptionFor(insight: Omit<SectorInsight, "description">): string {
  const direction = insight.score >= 0 ? "positive" : "negative";
  return `Live relative-strength reading: ${insight.change1D.toFixed(2)}% today, ${insight.change1W.toFixed(2)}% over 1 week, and ${insight.change1M.toFixed(2)}% over 1 month. The sector's 1-week and 1-month performance is ${direction} versus the Nifty 50 benchmark.`;
}

async function calculateInsights(): Promise<SectorInsight[]> {
  const benchmark = await fetchHistory(BENCHMARK);
  const benchmark1W = pct(benchmark.values.at(-1)!, benchmark.values.at(-6)!);
  const benchmark1M = pct(benchmark.values.at(-1)!, benchmark.values[0]);
  const results = await Promise.all(SECTORS.map(async (definition) => {
    const history = await fetchHistory(definition.symbol);
    const current = history.values.at(-1)!;
    const change1D = pct(current, history.values.at(-2)!);
    const change1W = pct(current, history.values.at(-6)!);
    const change1M = pct(current, history.values[0]);
    const relative1W = change1W - benchmark1W;
    const relative1M = change1M - benchmark1M;
    const score = change1D * 0.25 + relative1W * 0.45 + relative1M * 0.3;
    const trend = trendFor(score, relative1W, relative1M);
    const confidence: SectorInsight["confidence"] = history.values.length >= 20 && Math.abs(relative1W) + Math.abs(relative1M) >= 1 ? "High" : Math.abs(score) >= 0.75 ? "Medium" : "Low";
    const base = { sector: definition.sector, symbol: definition.symbol, trend, confidence, change1D, change1W, change1M, relative1W, relative1M, score, dataDate: history.dates.at(-1)! };
    return { ...base, description: descriptionFor(base) };
  }));
  return results.sort((a, b) => b.score - a.score);
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ insights: cached.data, cached: true, lastUpdated: cached.timestamp, source: "Yahoo Finance sector-index history" });
  }
  try {
    const insights = await calculateInsights();
    cached = { data: insights, timestamp: now };
    return NextResponse.json({ insights, cached: false, lastUpdated: now, source: "Yahoo Finance sector-index history" });
  } catch (error) {
    console.error("Error calculating sector rotation:", error);
    if (cached) return NextResponse.json({ insights: cached.data, cached: true, lastUpdated: cached.timestamp, source: "cached sector-index history" });
    return NextResponse.json({ error: "Live sector rotation is temporarily unavailable", insights: [], cached: false }, { status: 503 });
  }
}
