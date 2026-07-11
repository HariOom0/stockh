/**
 * Next.js instrumentation — runs once when the server starts.
 * Sets up a daily timer to auto-save volume shockers snapshot to the DB
 * at 7:15 PM IST every trading day (skips weekends & NSE holidays).
 */
import { isMarketClosed } from "@/lib/trading-calendar";

export async function register() {
  // Only run on the server side
  if (typeof window !== "undefined") return;

  scheduleDailySnapshot();
}

function scheduleDailySnapshot() {
  function msUntilNext715PM(): number {
    const now = new Date();

    // Get current IST components
    const istFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = istFormatter.formatToParts(now);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

    const istHour = get("hour");
    const istMinute = get("minute");
    const istSecond = get("second");

    // Target: 19:15:00 IST today (or tomorrow if already past)
    let targetHour = 19;
    let targetMinute = 15;

    // If current IST time is past 19:15, schedule for ~24 hours
    if (istHour > targetHour || (istHour === targetHour && istMinute >= targetMinute)) {
      return 24 * 60 * 60 * 1000;
    }

    // Calculate ms until 19:15 today
    const msUntilTarget =
      (targetHour - istHour) * 60 * 60 * 1000 +
      (targetMinute - istMinute) * 60 * 1000 -
      istSecond * 1000;

    return Math.max(msUntilTarget, 60 * 1000); // at least 1 minute
  }

  async function triggerSnapshot() {
    try {
      const url = "http://localhost:3000/api/volume-shockers";
      console.log(`[AutoSnapshot] Hitting ${url} ...`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.stocks) {
        console.log(`[AutoSnapshot] Saved ${data.stocks.length} stocks for ${data.tradingDate}`);
      } else {
        console.error(`[AutoSnapshot] Error:`, data.error || res.status);
      }
    } catch (err) {
      console.error("[AutoSnapshot] Failed:", err);
    }
  }

  function scheduleNext() {
    const delay = msUntilNext715PM();
    const runAt = new Date(Date.now() + delay);
    console.log(
      `[AutoSnapshot] Next snapshot scheduled at ${runAt.toISOString()} (${Math.round(delay / 60000)} min from now)`
    );

    setTimeout(async () => {
      // Get today's IST date to check market status
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      if (isMarketClosed(istDate)) {
        console.log(`[AutoSnapshot] Skipping ${istDate} — market closed (weekend or holiday)`);
      } else {
        await triggerSnapshot();
      }

      // Schedule the next day
      scheduleNext();
    }, delay);
  }

  // Start the scheduling loop
  scheduleNext();
}