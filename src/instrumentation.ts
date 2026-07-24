/**
 * Next.js instrumentation — runs once when the server starts.
 * Schedules daily auto-save at 7:15 PM IST on trading days.
 */
import { isMarketClosed } from "@/lib/trading-calendar";

export async function register() {
  if (typeof window !== "undefined") return;
  scheduleDailySnapshot();
}

function scheduleDailySnapshot() {
  function msUntilNext715PM(): number {
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

    if (istHour > 19 || (istHour === 19 && istMinute >= 15)) {
      return 24 * 60 * 60 * 1000;
    }

    const msUntilTarget =
      (19 - istHour) * 60 * 60 * 1000 +
      (15 - istMinute) * 60 * 1000 -
      istSecond * 1000;

    return Math.max(msUntilTarget, 60 * 1000);
  }

  async function triggerSnapshot() {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/volume-shockers`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.stocks) {
        console.log(`[AutoSnapshot] ${data.stocks.length} stocks for ${data.tradingDate}`);
      } else {
        console.error(`[AutoSnapshot] Error:`, data.error || res.status);
      }
    } catch (err) {
      console.error("[AutoSnapshot] Failed:", err);
    }
  }

  function scheduleNext() {
    const delay = msUntilNext715PM();
    console.log(`[AutoSnapshot] Next in ${Math.round(delay / 60000)} min`);
    setTimeout(async () => {
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      if (isMarketClosed(istDate)) {
        console.log(`[AutoSnapshot] Skipping ${istDate} — market closed`);
      } else {
        await triggerSnapshot();
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
