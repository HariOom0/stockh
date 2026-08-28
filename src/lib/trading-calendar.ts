/**
 * Trading calendar utility for NSE.
 *
 * Uses TradingView Scanner API (via fetch) to auto-detect trading days.
 * No hardcoded holidays. No execSync (Vercel-incompatible).
 *
 * - Weekends: detected locally (no API needed).
 * - Weekdays: checked against TradingView; if API is down, assumes trading day.
 */

// ─── In-memory cache: date string → true (market open) / false (closed) ─
const cache = new Map<string, boolean | null>();

// ─── Local weekend check (no API) ──────────────────────────────────────
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// ─── TradingView Scanner check (fetch-based, works on Vercel) ──────────
/**
 * Query TradingView Scanner for NIFTY50 index.
 * If it returns a valid close price, the market is open today.
 */
async function fetchTradingViewToday(): Promise<boolean | null> {
  try {
    const res = await fetch(
      "https://scanner.tradingview.com/india/scan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: { tickers: ["NSE:NIFTY"] },
          columns: ["close", "volume"],
          sort: { sortBy: "volume", sortOrder: "desc" },
          range: [0, 1],
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.data?.[0]?.d?.[0] && data.data[0].d[0] > 0) return true;
    return false;
  } catch {
    return null;
  }
}

/**
 * Check a historical date via TradingView chart data API.
 * If a daily bar exists for that date, the market was open.
 */
async function fetchTradingViewHistorical(dateStr: string): Promise<boolean | null> {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    // IST midnight = UTC 18:30 previous day
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const dayStartUTC = Date.UTC(y, m - 1, d) - istOffsetMs;
    const dayEndUTC = dayStartUTC + 24 * 60 * 60 * 1000;
    const from = Math.floor(dayStartUTC / 1000);
    const to = Math.floor(dayEndUTC / 1000);

    const res = await fetch(
      `https://api.tradingview.com/v1/symbols/NSE/NIFTY/bars?resolution=D&from=${from}&to=${to}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const bars = await res.json();
    return Array.isArray(bars) && bars.length > 0;
  } catch {
    return null;
  }
}

// ─── Public: synchronous check (cache-only, no network) ───────────────

/**
 * Returns true if market is closed on dateStr.
 * Uses only cached data. If no cache, assumes weekday = trading day.
 */
export function isMarketClosed(dateStr: string): boolean {
  if (isWeekend(dateStr)) return true;
  const cached = cache.get(dateStr);
  if (cached !== undefined) return !cached;
  // No cache → assume weekday is a trading day (conservative)
  return false;
}

// ─── Public: async check (fetches from TradingView if not cached) ──────

/**
 * Async check — queries TradingView if date not cached.
 */
export async function isMarketClosedAsync(dateStr: string): Promise<boolean> {
  if (isWeekend(dateStr)) return true;
  const cached = cache.get(dateStr);
  if (cached !== undefined) return !cached;

  // Check if it's today
  const istDate = getISTDate();
  let isOpen: boolean | null = null;

  if (dateStr === istDate) {
    isOpen = await fetchTradingViewToday();
  } else {
    isOpen = await fetchTradingViewHistorical(dateStr);
  }

  if (isOpen !== null) {
    cache.set(dateStr, isOpen);
    return !isOpen;
  }

  // API failed — assume weekday is trading day
  return false;
}

// ─── Public: refresh cache for recent dates ────────────────────────────

/**
 * Pre-populate cache for today and the last few weekdays.
 */
export async function refreshTradingDayCache(): Promise<void> {
  const istDate = getISTDate();
  // Check today via scanner (fast)
  const todayOpen = await fetchTradingViewToday();
  if (todayOpen !== null) {
    cache.set(istDate, todayOpen);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getISTDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getISTHourMinute(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
  return { hour: get("hour"), minute: get("minute") };
}

// ─── Public: get last open market date walking backwards ────────────────

export function getLastOpenMarketDate(dateStr: string): string {
  let d = new Date(dateStr + "T00:00:00Z");
  let safety = 0;
  while (safety < 15) {
    const candidate = d.toISOString().slice(0, 10);
    if (!isWeekend(candidate)) {
      const cached = cache.get(candidate);
      if (cached === undefined || cached === true) {
        // Not cached (assume open) or confirmed open
        return candidate;
      }
      // cached === false → holiday, keep walking
    }
    d.setUTCDate(d.getUTCDate() - 1);
    safety++;
  }
  return dateStr;
}

// ─── Public: get the trading date for EOD display ──────────────────────

/**
 * Compute the EOD trading date.
 *
 * After 3:30 PM IST on a weekday:
 *   → If we know today is a trading day → return today
 *   → If we don't know → return today (assume trading day, data will confirm)
 *
 * Before 3:30 PM IST or on weekends:
 *   → Walk backwards to last trading day
 */
export function getTradingDate(): string {
  const istDate = getISTDate();
  const { hour, minute } = getISTHourMinute();

  // Weekend → walk back
  if (isWeekend(istDate)) {
    return getLastOpenMarketDate(istDate);
  }

  const afterClose = hour > 15 || (hour === 15 && minute >= 30);

  if (afterClose) {
    // After market close: check cache
    const cached = cache.get(istDate);
    if (cached === false) {
      // Known holiday → walk back
      return getLastOpenMarketDate(istDate);
    }
    // Known trading day OR unknown → return today
    return istDate;
  }

  // Before market close → show last trading day
  const yesterday = new Date(istDate + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return getLastOpenMarketDate(yesterday.toISOString().slice(0, 10));
}

// ─── Auto-refresh on module load (non-blocking) ───────────────────────
refreshTradingDayCache().catch(() => {});
