// Quick test: can we scrape Chartink from this server?
import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHARTINK_SCAN_CONDITION =
  "( ( 57369.11*(latest_volume/latest_avg_volume_30_cumulative ) ) >= 180 )";

async function testChartinkAPI() {
  console.log("Step 1: Getting Chartink session...");
  const pageResp = await fetch("https://chartink.com/screener/process", {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  console.log(`Session status: ${pageResp.status}`);
  const pageHtml = await pageResp.text();
  
  const csrfMatch = pageHtml.match(/csrf-token" content="([^"]+)"/);
  const csrf = csrfMatch?.[1];
  console.log(`CSRF token found: ${!!csrf}`);

  if (!csrf) {
    console.log("Page HTML (first 500 chars):", pageHtml.slice(0, 500));
    throw new Error("No CSRF token");
  }

  const setCookies = pageResp.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
  console.log(`Cookies: ${cookieStr.slice(0, 80)}...`);

  console.log("\nStep 2: POSTing to Chartink API...");
  const apiResp = await fetch("https://chartink.com/screener/process", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf,
      Origin: "https://chartink.com",
      Referer: "https://chartink.com/screener",
      Cookie: cookieStr,
    },
    body: JSON.stringify({ scan_condition: CHARTINK_SCAN_CONDITION }),
    signal: AbortSignal.timeout(30000),
  });

  console.log(`API status: ${apiResp.status}`);
  const json = await apiResp.json();
  const data = json.data || [];
  console.log(`Stocks returned: ${data.length}`);

  if (data.length > 0) {
    console.log("\nFirst 5 results:");
    data.slice(0, 5).forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.n} (${row.sl}) - Close: ${row.c}, Change: ${row.chg}%, Vol Gain: ${row.vg}%`);
    });
  }
}

testChartinkAPI().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});