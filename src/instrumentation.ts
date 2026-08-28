/**
 * Next.js instrumentation — runs once when the server starts.
 * Schedules daily auto-save at 7:00 PM IST on trading days.
 */
import { isMarketClosedAsync, refreshTradingDayCache } from "@/lib/trading-calendar";

export async function register() {
  if (typeof window !== "undefined") return;
  scheduleDailySnapshot();
}

function scheduleDailySnapshot() {
  function msUntilNext7PM(): number {
    const now = new Date();
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

    // If past 7 PM, wait until tomorrow
    if (istHour > 19 || (istHour === 19 && istMinute >= 0)) {
      return 24 * 60 * 60 * 1000;
    }

    const msUntilTarget =
      (19 - istHour) * 60 * 60 * 1000 +
      (0 - istMinute) * 60 * 1000 -
      istSecond * 1000;

    return Math.max(msUntilTarget, 60 * 1000);
  }

  async function triggerSnapshot() {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/cron/daily-snapshot`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok && !data.skipped) {
        console.log(`[AutoSnapshot] Saved ${data.stockCount} stocks for ${data.tradingDate}`);
      } else {
        console.log(`[AutoSnapshot] Skipped: ${data.reason || "unknown"}`);
      }
    } catch (err) {
      console.error("[AutoSnapshot] Failed:", err);
    }
  }

  async function scheduleNext() {
    const delay = msUntilNext7PM();
    console.log(`[AutoSnapshot] Next in ${Math.round(delay / 60000)} min`);
    setTimeout(async () => {
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      // Refresh cache then check async
      await refreshTradingDayCache();
      const closed = await isMarketClosedAsync(istDate);
      if (closed) {
        console.log(`[AutoSnapshot] Skipping ${istDate} — market closed`);
      } else {
        await triggerSnapshot();
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
