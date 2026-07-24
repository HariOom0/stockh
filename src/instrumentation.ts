/**
 * Next.js instrumentation — runs once when the server starts.
 * 1. Seeds historical data if database is empty
 * 2. Schedules daily auto-save at 7:15 PM IST on trading days
 */
import { isMarketClosed } from "@/lib/trading-calendar";

export async function register() {
  if (typeof window !== "undefined") return;

  // Seed historical data on cold start (non-blocking)
  seedHistoryIfNeeded().catch((err) =>
    console.warn("[Seed] Background seed failed:", err)
  );

  scheduleDailySnapshot();
}

/**
 * If the database has no snapshots, seed it with data from seed-data.json.
 * This runs once on cold start and is non-blocking.
 */
async function seedHistoryIfNeeded() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://"))) {
    return; // No valid DB, skip seeding
  }

  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { db } = await import("@/lib/db");

    // Check if database already has data
    const existingCount = await db.dailyStockSnapshot.count();
    if (existingCount > 0) {
      console.log(`[Seed] Database already has ${existingCount} snapshots, skipping seed`);
      return;
    }

    // Read seed data
    const seedPath = join(process.cwd(), "prisma", "seed-data.json");
    const raw = readFileSync(seedPath, "utf-8");
    const seedData: Record<string, any[]> = JSON.parse(raw);

    let seeded = 0;
    for (const [date, stocks] of Object.entries(seedData)) {
      if (!Array.isArray(stocks) || stocks.length === 0) continue;

      await db.dailyStockSnapshot.create({
        data: {
          date,
          stockCount: stocks.length,
          stocksJson: JSON.stringify(stocks),
        },
      });
      seeded++;
      console.log(`[Seed] Seeded ${stocks.length} stocks for ${date}`);
    }

    console.log(`[Seed] Done — seeded ${seeded} dates`);
  } catch (err: any) {
    console.warn("[Seed] Failed:", err.message);
  }
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

    let targetHour = 19;
    let targetMinute = 15;

    if (istHour > targetHour || (istHour === targetHour && istMinute >= targetMinute)) {
      return 24 * 60 * 60 * 1000;
    }

    const msUntilTarget =
      (targetHour - istHour) * 60 * 60 * 1000 +
      (targetMinute - istMinute) * 60 * 1000 -
      istSecond * 1000;

    return Math.max(msUntilTarget, 60 * 1000);
  }

  async function triggerSnapshot() {
    try {
      const url = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/volume-shockers`
        : "http://localhost:3000/api/volume-shockers";
      console.log(`[AutoSnapshot] Fetching ${url} ...`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.stocks) {
        console.log(`[AutoSnapshot] Got ${data.stocks.length} stocks for ${data.tradingDate} (source: ${data.source || "unknown"})`);
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
      `[AutoSnapshot] Next snapshot at ${runAt.toISOString()} (${Math.round(delay / 60000)} min)`
    );

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
