/**
 * Trading calendar utility for NSE (National Stock Exchange of India).
 *
 * Handles:
 *  1. Weekend detection (Saturday / Sunday)
 *  2. NSE trading-holiday detection (hardcoded per year, updated annually)
 *  3. "Last trading date" computation
 *
 * NSE publishes its holiday list every December for the coming year.
 * If the hardcoded list is outdated, the data-fingerprint check in the
 * API route acts as a safety net — it will still refuse to save duplicate
 * data even for an unrecognised holiday.
 */

// ─── NSE Trading Holidays (weekdays only) ────────────────────────────────
// Format: "YYYY-MM-DD"
// Only days that fall on Mon–Fri need to be listed;
// Sat/Sun holidays are already covered by weekend logic.
// Source: NSE circular "Trading Holidays for the Calendar Year 2026"
// Update this list every January.
const NSE_HOLIDAYS_2026: string[] = [
  "2026-01-26", // Republic Day (Monday)
  "2026-02-26", // Mahashivratri (Thursday)
  "2026-03-30", // Eid-Ul-Fitr (Monday)
  "2026-04-02", // Annual Closing of Banks (Thursday)
  "2026-04-14", // Dr. Babasaheb Ambedkar Jayanti (Tuesday)
  "2026-05-01", // Maharashtra Day (Friday)
  "2026-06-05", // Bakri Id / Eid al-Adha (Friday)
  "2026-08-27", // Janmashtami (Thursday)
  "2026-10-02", // Mahatma Gandhi Jayanti (Friday)
  "2026-10-20", // Dussehra (Tuesday)
  "2026-11-05", // Diwali – Laxmi Pujan (Thursday)
  "2026-11-06", // Diwali – Balipratipada (Friday)
  "2026-12-25", // Christmas (Friday)
];

/** All known NSE holidays as a Set for O(1) lookups. */
const holidaySet = new Set(NSE_HOLIDAYS_2026);

// Also attempt to fetch live holiday data on first use.
// If the fetch succeeds, the live data replaces the hardcoded set.
let holidayFetchAttempted = false;

/**
 * Try to enrich the holiday set from a publicly accessible source.
 * Runs at most once per server lifetime.
 * Currently tries to fetch from the NSE holiday calendar.
 * If it fails (common from server environments), the hardcoded list is used.
 */
async function tryFetchLiveHolidays() {
  if (holidayFetchAttempted) return;
  holidayFetchAttempted = true;

  try {
    // Attempt to fetch NSE holidays via a session-based request
    const res = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      // NSE returns { CBM: [...], NSE: [...] } — we want the "NSE" array
      const nseHolidays = data?.NSE;
      if (Array.isArray(nseHolidays)) {
        for (const h of nseHolidays) {
          // h.tradingDate is "MMM DD, YYYY" e.g. "Jan 26, 2026"
          const d = new Date(h.tradingDate);
          if (!isNaN(d.getTime())) {
            const iso = d.toISOString().slice(0, 10);
            holidaySet.add(iso);
          }
        }
        console.log(`[TradingCalendar] Loaded ${nseHolidays.length} NSE holidays from API`);
      }
    }
  } catch {
    // Silently fall back to hardcoded list
    console.log("[TradingCalendar] NSE API unavailable, using hardcoded holiday list");
  }
}

// Kick off the async fetch (non-blocking)
tryFetchLiveHolidays();

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Returns true if `dateStr` (YYYY-MM-DD) is a weekend (Sat/Sun).
 * The date string is parsed as UTC midnight to avoid DST shifts.
 */
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Returns true if `dateStr` (YYYY-MM-DD) is an NSE trading holiday.
 */
function isHoliday(dateStr: string): boolean {
  return holidaySet.has(dateStr);
}

/**
 * Returns true if the market is CLOSED on `dateStr`.
 */
export function isMarketClosed(dateStr: string): boolean {
  return isWeekend(dateStr) || isHoliday(dateStr);
}

/**
 * Starting from `dateStr` (YYYY-MM-DD), walk backwards day-by-day
 * until we find a date that is NOT a weekend and NOT a holiday.
 * Returns the last open-market date in YYYY-MM-DD format.
 */
export function getLastOpenMarketDate(dateStr: string): string {
  let d = new Date(dateStr + "T00:00:00Z");
  while (isWeekend(d.toISOString().slice(0, 10)) || isHoliday(d.toISOString().slice(0, 10))) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the actual EOD trading date that Chartink's data represents.
 *
 * Logic:
 *  1. Get current IST date & hour.
 *  2. If IST hour < 19 (before 7 PM) → EOD data is from a previous day.
 *  3. Starting from the candidate date, walk backwards past any
 *     weekends or NSE holidays to land on the last actual trading day.
 */
export function getTradingDate(): string {
  const now = new Date();

  // IST date as YYYY-MM-DD
  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // IST hour (24h, no leading zero)
  const istHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );

  // Before 7 PM IST → data is from a prior trading day
  let candidate = istDate;
  if (istHour < 19) {
    const d = new Date(candidate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    candidate = d.toISOString().slice(0, 10);
  }

  // Walk backwards past weekends & holidays
  return getLastOpenMarketDate(candidate);
}