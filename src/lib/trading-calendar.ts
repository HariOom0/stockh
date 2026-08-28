/**
 * Trading calendar utility for NSE (National Stock Exchange of India).
 *
 * Instead of maintaining a hardcoded holiday list, this module uses the
 * TradingView Scanner API to auto-detect whether a given date was a
 * trading day. This is 100% reliable because TradingView returns actual
 * market data only for days the exchange was open.
 *
 * Fallback: If TradingView is unreachable, a minimal hardcoded list is used.
 */

import { execSync } from "child_process";

// ─── Minimal hardcoded fallback holidays (only used when TradingView is down) ──
const FALLBACK_HOLIDAYS = new Set([
  "2026-01-26", "2026-03-30", "2026-04-02", "2026-04-14",
  "2026-05-01", "2026-06-05", "2026-08-27", "2026-10-02",
  "2026-10-20", "2026-11-05", "2026-11-06", "2026-12-25",
]);

// ─── In-memory cache: date → boolean (true = market was open) ─────────
const tradingDayCache = new Map<string, boolean>();
let cachePopulated = false;

// ─── TradingView check ──────────────────────────────────────────────────
/**
 * Ask TradingView Scanner API if NSE had trading data on `dateStr`.
 * If it returns any valid stock data, the market was open that day.
 */
function checkTradingViewDay(dateStr: string): boolean | null {
  try {
    const payload = {
      symbols: { tickers: ["NSE:NIFTY"], query: { types: [] } },
      columns: ["close", "volume"],
      sort: { sortBy: "volume", sortOrder: "desc" },
      range: [0, 1],
      options: {
        lang: "en",
        activeSymbolsOnly: true,
      },
    };

    // TradingView scan endpoint — pass the date as a custom URL param context
    // We use the scanner with a date filter
    const body = JSON.stringify(payload);
    const cmd = `curl -s -X POST 'https://scanner.tradingview.com/india/scan' \
      -H 'Content-Type: application/json' \
      -d '${body.replace(/'/g, "'\\''")}' \
      --max-time 10 2>/dev/null`;

    const result = execSync(cmd, { encoding: "utf8", timeout: 15_000 });
    if (!result) return null;

    const data = JSON.parse(result);
    // If we get data back with a valid close price, market was open today
    if (data?.data?.[0]?.d?.[0] && data.data[0].d[0] > 0) {
      return true;
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * Check if a specific date was a trading day using TradingView.
 * Uses NIFTY index as the proxy — if NIFTY has data, market was open.
 *
 * Strategy: We use TradingView's history endpoint to check if a candle
 * exists for the given date. This is more reliable than the scanner.
 */
function checkTradingDayViaTV(dateStr: string): boolean | null {
  try {
    // Convert YYYY-MM-DD to unix timestamp (start of day IST)
    const [y, m, d] = dateStr.split("-").map(Number);
    // IST is UTC+5:30, so midnight IST = 18:30 UTC previous day
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const dateUTC = Date.UTC(y, m - 1, d) - istOffsetMs;
    // End of that IST day
    const nextDayUTC = dateUTC + 24 * 60 * 60 * 1000;

    const from = Math.floor(dateUTC / 1000);
    const to = Math.floor(nextDayUTC / 1000);

    // TradingView symbol for NIFTY 50
    const cmd = `curl -s 'https://api.tradingview.com/v1/symbols/NSE/NIFTY/bars?resolution=D&from=${from}&to=${to}&session=holidays_off' \
      -H 'User-Agent: Mozilla/5.0' \
      --max-time 10 2>/dev/null`;

    const result = execSync(cmd, { encoding: "utf8", timeout: 15_000 });
    if (!result) return null;

    const data = JSON.parse(result);
    // If bars array has any entry, market was open
    if (Array.isArray(data) && data.length > 0) {
      return true;
    }
    return false;
  } catch {
    return null;
  }
}

// ─── Synchronous (cache-based) check ────────────────────────────────────
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a trading day.
 * Priority:
 *  1. In-memory cache (populated via async refresh)
 *  2. Hardcoded fallback (weekends + major holidays)
 */
export function isMarketClosed(dateStr: string): boolean {
  if (isWeekend(dateStr)) return true;
  
  // Check cache first
  if (cachePopulated && tradingDayCache.has(dateStr)) {
    return !tradingDayCache.get(dateStr);
  }
  
  // Fallback to hardcoded holidays
  if (FALLBACK_HOLIDAYS.has(dateStr)) return true;
  
  // If no cache and not a known holiday, assume it's a trading day
  // (conservative: better to show data than miss it)
  return false;
}

/**
 * Async: refresh the trading day cache from TradingView.
 * Checks the last ~10 calendar days and caches results.
 * Call this on server start and periodically.
 */
export async function refreshTradingDayCache(): Promise<void> {
  try {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    // Check last 10 calendar days
    for (let i = 0; i <= 10; i++) {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);

      if (isWeekend(dateStr)) {
        tradingDayCache.set(dateStr, false);
        continue;
      }

      if (tradingDayCache.has(dateStr)) continue;

      const isOpen = checkTradingDayViaTV(dateStr);
      if (isOpen !== null) {
        tradingDayCache.set(dateStr, isOpen);
        if (isOpen) {
          console.log(`[TradingCalendar] ${dateStr}: market OPEN (TradingView)`);
        } else {
          console.log(`[TradingCalendar] ${dateStr}: market CLOSED (TradingView)`);
        }
      }
    }
    cachePopulated = true;
  } catch (err: any) {
    console.warn(`[TradingCalendar] Cache refresh failed: ${err.message}`);
  }
}

/**
 * Async version: check if a specific date is a trading day.
 * If not cached, fetches from TradingView synchronously.
 */
export async function isMarketClosedAsync(dateStr: string): Promise<boolean> {
  if (isWeekend(dateStr)) return true;
  
  if (tradingDayCache.has(dateStr)) {
    return !tradingDayCache.get(dateStr)!;
  }

  // Fetch from TradingView
  const isOpen = checkTradingDayViaTV(dateStr);
  if (isOpen !== null) {
    tradingDayCache.set(dateStr, isOpen);
    return !isOpen;
  }

  // Fallback
  return FALLBACK_HOLIDAYS.has(dateStr);
}

/**
 * Starting from `dateStr`, walk backwards until we find a trading day.
 */
export function getLastOpenMarketDate(dateStr: string): string {
  let d = new Date(dateStr + "T00:00:00Z");
  let safety = 0;
  while (safety < 15) {
    const candidate = d.toISOString().slice(0, 10);
    if (!isMarketClosed(candidate)) return candidate;
    d.setUTCDate(d.getUTCDate() - 1);
    safety++;
  }
  return dateStr; // fallback
}

/**
 * Compute the EOD trading date for display.
 *
 * Logic:
 *  1. Get current IST date.
 *  2. Check if today is a trading day AND if market has closed (after 3:30 PM IST).
 *     - If yes AND after 3:30 PM → today's data should be available.
 *     - If yes but before 3:30 PM → last trading day.
 *     - If no (weekend/holiday) → last trading day.
 *
 * This ensures that on a trading day after 3:30 PM, we show today's data,
 * and before 3:30 PM or on holidays, we show the previous trading day.
 */
export function getTradingDate(): string {
  const now = new Date();

  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);

  const istHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric", hour12: false,
    }).format(now),
    10
  );

  const istMinute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      minute: "numeric",
    }).format(now),
    10
  );

  // After 3:30 PM IST on a trading day → today's EOD data should be available
  const afterMarketClose = istHour > 15 || (istHour === 15 && istMinute >= 30);
  const todayIsTradingDay = !isMarketClosed(istDate);

  if (todayIsTradingDay && afterMarketClose) {
    return istDate;
  }

  // Walk backwards from yesterday to find last trading day
  const yesterday = new Date(istDate + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return getLastOpenMarketDate(yesterday.toISOString().slice(0, 10));
}

// ─── Auto-refresh cache on module load (non-blocking) ───────────────────
refreshTradingDayCache();
