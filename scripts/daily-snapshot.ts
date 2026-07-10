/**
 * Daily snapshot saver — call the volume-shockers API to trigger a DB save.
 * Designed to be run via cron at 7:15 PM IST every weekday.
 *
 * Usage:
 *   npx tsx scripts/daily-snapshot.ts
 *   # or with bun:
 *   bun scripts/daily-snapshot.ts
 */
const BASE_URL = process.env.SNAPSHOT_URL || "http://localhost:3000";

async function saveSnapshot() {
  const url = `${BASE_URL}/api/volume-shockers`;
  console.log(`[${new Date().toISOString()}] Hitting ${url} to save daily snapshot...`);

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data.stocks) {
      console.log(
        `[${new Date().toISOString()}] ✅ Snapshot saved: ${data.stocks.length} stocks`
      );
    } else {
      console.error(
        `[${new Date().toISOString()}] ❌ API returned error:`,
        data.error || res.status
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to reach API:`, err);
    process.exit(1);
  }
}

saveSnapshot();