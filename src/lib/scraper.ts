import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ─── Chartink Configuration ───────────────────────────────────────────
const CHARTINK_SCAN_CLAUSE =
  "( {cash} ( daily volume > daily sma( volume,20 ) * 5 ) )";
const CHARTINK_URL = "https://chartink.com/screener/process";
const CHARTINK_PAGE = "https://chartink.com/screener/volume-shockers";

// ═══════════════════════════════════════════════════════════════════════
// Volume Shocker Types
// ═══════════════════════════════════════════════════════════════════════

export interface VolumeShockerStock {
  sr: number;
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
}

interface ChartinkRow {
  sr: number;
  nsecode: string;
  name: string;
  bsecode: string | null;
  close: number;
  per_chg: number;
  volume: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Chartink Scraper — Puppeteer (bypasses Cloudflare)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch volume shockers from Chartink using a headless browser.
 * Cloudflare blocks plain fetch/XHR from server — so we launch a real
 * browser, let it pass the CF challenge, then execute the API call
 * from *inside* the page context (page.evaluate).
 */
async function fetchChartinkViaPuppeteer(): Promise<ChartinkRow[]> {
  // Dynamic imports — @sparticuz/chromium exports via .default, NOT named
  const chromiumMod = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default ?? chromiumMod;
  const puppeteerMod = await import("puppeteer-core");
  const puppeteer = puppeteerMod.default ?? puppeteerMod;

  console.log("[Chartink] Launching headless Chromium...");

  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    defaultViewport: chromium.defaultViewport,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // Step 1 — Navigate to the screener page & wait for CF challenge
    console.log("[Chartink] Navigating to screener page...");
    await page.goto(CHARTINK_PAGE, {
      waitUntil: "networkidle2",
      timeout: 35_000,
    });

    // Wait until Cloudflare "checking your browser" is gone
    console.log("[Chartink] Waiting for Cloudflare challenge...");
    await page.waitForFunction(
      () => {
        const txt = document.body?.innerText ?? "";
        return txt.length > 200 && !txt.includes("Checking your browser");
      },
      { timeout: 25_000 }
    );

    // Small settle — let any post-CF JS finish
    await new Promise((r) => setTimeout(r, 1500));

    // Step 2 — Read the XSRF-TOKEN cookie from the browser, then call
    // screener/process from INSIDE the page context.  The XSRF token is
    // required by Laravel (HTTP 419 if missing / mismatched).
    console.log("[Chartink] Fetching stock data via in-browser XHR...");
    const result = await page.evaluate(
      async (apiUrl: string, scanClause: string) => {
        // Extract XSRF token from browser cookies
        const cookieStr = document.cookie;
        const xsrfMatch = cookieStr.match(/XSRF-TOKEN=([^;]+)/);
        const xsrfToken = xsrfMatch
          ? decodeURIComponent(xsrfMatch[1])
          : "";

        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json",
        };
        if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;

        try {
          const res = await fetch(apiUrl, {
            method: "POST",
            headers,
            credentials: "include",
            body: `scan_clause=${encodeURIComponent(scanClause)}&start=0&length=200`,
          });
          if (!res.ok)
            return {
              error: `HTTP ${res.status} ${res.statusText}`,
            };
          return await res.json();
        } catch (e: any) {
          return { error: e.message || String(e) };
        }
      },
      CHARTINK_URL,
      CHARTINK_SCAN_CLAUSE
    );

    if (result.error) {
      throw new Error(`In-browser fetch: ${result.error}`);
    }

    const data: ChartinkRow[] = result.data ?? [];
    console.log(
      `[Chartink] Got ${data.length} stocks (recordsTotal: ${result.recordsTotal})`
    );
    return data;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Chartink Scraper — Direct fetch fallback
// ═══════════════════════════════════════════════════════════════════════

/**
 * Direct HTTP approach (works locally where Cloudflare may not block,
 * or as a fallback on Vercel if Puppeteer fails).
 */
async function fetchChartinkViaFetch(): Promise<ChartinkRow[]> {
  const pageRes = await fetch(CHARTINK_PAGE, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!pageRes.ok) throw new Error(`Page fetch: ${pageRes.status}`);

  const setCookies = pageRes.headers.getSetCookie?.() ?? [];
  let rawXsrf = "";
  let rawCiSession = "";
  for (const h of setCookies) {
    const m1 = h.match(/XSRF-TOKEN=(.+?);/);
    if (m1) rawXsrf = m1[1];
    const m2 = h.match(/ci_session=(.+?);/);
    if (m2) rawCiSession = m2[1];
  }
  if (!rawXsrf || !rawCiSession) {
    throw new Error("Failed to extract XSRF-TOKEN / ci_session cookies");
  }

  const decodedXsrf = decodeURIComponent(rawXsrf);
  const postRes = await fetch(CHARTINK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `ci_session=${rawCiSession}; XSRF-TOKEN=${rawXsrf}`,
      "X-XSRF-TOKEN": decodedXsrf,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
      Referer: CHARTINK_PAGE,
      "User-Agent": USER_AGENT,
    },
    body: `scan_clause=${encodeURIComponent(CHARTINK_SCAN_CLAUSE)}&start=0&length=200`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!postRes.ok) throw new Error(`API call: ${postRes.status}`);
  const json = await postRes.json();
  const data: ChartinkRow[] = json.data ?? [];
  console.log(
    `[Chartink] Direct fetch got ${data.length} stocks (recordsTotal: ${json.recordsTotal})`
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// Combined Chartink fetch — Puppeteer first, fetch fallback
// ═══════════════════════════════════════════════════════════════════════

async function fetchChartinkStocks(): Promise<ChartinkRow[]> {
  // Strategy 1: Puppeteer (bypasses Cloudflare reliably)
  try {
    return await fetchChartinkViaPuppeteer();
  } catch (err: any) {
    console.warn(`[Chartink] Puppeteer failed: ${err.message}`);
  }

  // Strategy 2: Direct fetch (may work locally / when CF is lenient)
  try {
    return await fetchChartinkViaFetch();
  } catch (err: any) {
    console.warn(`[Chartink] Direct fetch also failed: ${err.message}`);
  }

  throw new Error("All Chartink fetch strategies failed");
}

// ═══════════════════════════════════════════════════════════════════════
// Yahoo Finance — 20-day Volume Average (for volGainPct)
// ═══════════════════════════════════════════════════════════════════════

interface YahooChartResult {
  avgVol20d: number;
  todayVolume: number;
}

async function fetchYahooVolAvg(
  ticker: string
): Promise<YahooChartResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS?range=1mo&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const quote = result.indicators?.quote?.[0];
    if (!quote) return null;

    const volumes: number[] = (quote.volume ?? []).filter(
      (v: number | null) => v !== null && v > 0
    );
    if (volumes.length < 5) return null;

    const todayVolume = volumes[volumes.length - 1];
    const prevVols = volumes.slice(-21, -1);
    const avgVol20d =
      prevVols.length > 0
        ? prevVols.reduce((a, b) => a + b, 0) / prevVols.length
        : todayVolume;

    return { avgVol20d, todayVolume };
  } catch {
    return null;
  }
}

/**
 * Fetch volume averages with concurrency, wrapped in a hard timeout.
 * If the whole operation takes too long, return whatever we have.
 */
async function fetchVolumeAverages(
  tickers: string[],
  concurrency = 10,
  overallMs = 20_000
): Promise<Map<string, YahooChartResult>> {
  const results = new Map<string, YahooChartResult>();
  let index = 0;

  async function worker() {
    while (index < tickers.length) {
      const i = index++;
      if (i >= tickers.length) break;
      const ticker = tickers[i];
      const data = await fetchYahooVolAvg(ticker);
      if (data) results.set(ticker, data);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tickers.length) },
    () => worker()
  );

  // Race all workers against the hard timeout
  await Promise.race([
    Promise.all(workers),
    new Promise<void>((resolve) => setTimeout(resolve, overallMs)),
  ]);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// Main: fetchVolumeShockers
// ═══════════════════════════════════════════════════════════════════════

export async function fetchVolumeShockers(): Promise<VolumeShockerStock[]> {
  // Step 1: Get stock list from Chartink (Puppeteer → fetch fallback)
  const chartinkData = await fetchChartinkStocks();
  if (chartinkData.length === 0) return [];

  // Step 2: Optionally enrich with Yahoo volume averages
  const tickers = chartinkData.map((s) => s.nsecode);
  console.log(
    `[Scraper] Enriching ${tickers.length} stocks with volume averages (20 s budget)...`
  );
  const volAvgs = await fetchVolumeAverages(tickers, 10, 20_000);
  console.log(
    `[Scraper] Got volume averages for ${volAvgs.size}/${tickers.length} stocks`
  );

  // Step 3: Merge data
  const results: VolumeShockerStock[] = chartinkData.map((row, idx) => {
    const yahoo = volAvgs.get(row.nsecode);
    let volGainPct: number;

    if (yahoo && yahoo.avgVol20d > 0) {
      volGainPct =
        Math.round(((yahoo.todayVolume / yahoo.avgVol20d) - 1) * 1000) / 10;
    } else {
      // The scan guarantees volume > 5x 20-day SMA → at least 400% gain.
      // We use a safe floor estimate.
      volGainPct = 500;
    }

    const name = row.name.replace(/\s*(Ltd|Limited)\.?\s*$/i, "").trim();

    return {
      sr: idx + 1,
      name,
      ticker: row.nsecode,
      close: row.close,
      change: Math.round(row.per_chg * 100) / 100,
      volGainPct,
      isPositive: row.per_chg > 0,
    };
  });

  // Sort by volGainPct descending
  results.sort((a, b) => b.volGainPct - a.volGainPct);
  results.forEach((r, i) => (r.sr = i + 1));

  console.log(
    `[Scraper] Returning ${results.length} volume shockers from Chartink`
  );
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// Stock Detail Scraper (Screener.in) — unchanged
// ═══════════════════════════════════════════════════════════════════════

export interface StockDetail {
  name: string;
  ticker: string;
  bseCode?: string;
  nseCode?: string;
  sector?: string;
  industry?: string;
  about?: string;
  indices?: string[];
  metrics: Record<string, string>;
  quarters: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  peers: { name: string; ticker: string }[];
  pros?: string[];
  cons?: string[];
  balanceSheet?: {
    label: string;
    reserves: string;
    borrowing: string;
    otherLiab: string;
    totalLiab: string;
    fixedAssets: string;
    cwip: string;
    totalAssets: string;
  }[];
  shareholding?: {
    category: string;
    values: { label: string; value: string }[];
  }[];
  annualResults?: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  cashFlow?: {
    label: string;
    operatingCF: string;
    investingCF: string;
    financingCF: string;
  }[];
}

export async function fetchStockDetail(ticker: string): Promise<StockDetail> {
  const url = `https://www.screener.in/company/${ticker}/`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok)
    throw new Error(
      `Failed to fetch screener for ${ticker}: ${res.status}`
    );

  const html = await res.text();
  const $ = cheerio.load(html);

  const detail: StockDetail = {
    name: "",
    ticker,
    metrics: {},
    quarters: [],
    peers: [],
  };

  // Company name
  detail.name = $("h1.h2").first().text().trim().replace(/\s+/g, " ");

  // BSE / NSE codes
  const companyInfoText = $(".company-info-strip").text() || "";
  const bseMatch = companyInfoText.match(/BSE:\s*(\d+)/);
  const nseMatch = companyInfoText.match(/NSE:\s*(\w+)/);
  if (bseMatch) detail.bseCode = bseMatch[1];
  if (nseMatch) detail.nseCode = nseMatch[1];

  // Sector & Industry
  const peersSection = $("#peers");
  if (peersSection.length) {
    const links = peersSection.find("a[title]");
    links.each((_, el) => {
      const title = $(el).attr("title") || "";
      const text = $(el).text().trim();
      if (title === "Sector" && text) detail.sector = text;
      if (title === "Industry" && text) detail.industry = text;
    });
  }

  // About
  detail.about = $(".about p").first().text().trim().replace(/\s+/g, " ");

  // Key metrics
  const ratioRows = $("#top-ratios li.flex.flex-space-between");
  ratioRows.each((_, el) => {
    const labelEl = $(el).find(".name");
    const valueEl = $(el).find(".value .number");
    const label = labelEl.text().trim();
    const value = valueEl.first().text().trim();
    if (label && value) detail.metrics[label] = value;
  });

  // Pros & Cons
  const prosList: string[] = [];
  const consList: string[] = [];
  $("div.pros ul li").each((_, el) => {
    const text = $(el).text().trim();
    if (text) prosList.push(text);
  });
  $("div.cons ul li").each((_, el) => {
    const text = $(el).text().trim();
    if (text) consList.push(text);
  });
  if (prosList.length > 0) detail.pros = prosList;
  if (consList.length > 0) detail.cons = consList;

  // Quarterly results
  const quarterlyTable = $("#quarters table");
  if (quarterlyTable.length) {
    const headers: string[] = [];
    quarterlyTable
      .find("thead th")
      .each((_, el) => headers.push($(el).text().trim()));

    const rows = quarterlyTable.find("tbody tr");
    let salesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let profitRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let opmRow: cheerio.Cheerio<cheerio.Element> | null = null;

    rows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue"))
        salesRow = $(el);
      if (firstCell.includes("net profit") || firstCell.includes("profit for"))
        profitRow = $(el);
      if (firstCell.includes("opm") || firstCell.includes("operating"))
        opmRow = $(el);
    });

    for (let i = 1; i < headers.length; i++) {
      detail.quarters.push({
        label: headers[i],
        sales: salesRow ? salesRow.find("td").eq(i).text().trim() : "-",
        netProfit: profitRow
          ? profitRow.find("td").eq(i).text().trim()
          : "-",
        opm: opmRow ? opmRow.find("td").eq(i).text().trim() : "-",
      });
    }
  }

  // Annual results
  const annualTable = $("table#annual-results-table, #annual table");
  if (annualTable.length) {
    const annHeaders: string[] = [];
    annualTable
      .find("thead th")
      .each((_, el) => annHeaders.push($(el).text().trim()));

    const annRows = annualTable.find("tbody tr");
    let annSalesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let annProfitRow: cheerio.Cheerio<cheerio.Element> | null = null;

    annRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue"))
        annSalesRow = $(el);
      if (firstCell.includes("net profit") || firstCell.includes("profit for"))
        annProfitRow = $(el);
    });

    if (annSalesRow || annProfitRow) {
      const annualResults: StockDetail["annualResults"] = [];
      for (let i = 1; i < annHeaders.length; i++) {
        annualResults.push({
          label: annHeaders[i],
          sales: annSalesRow
            ? annSalesRow.find("td").eq(i).text().trim()
            : "-",
          netProfit: annProfitRow
            ? annProfitRow.find("td").eq(i).text().trim()
            : "-",
          opm: "-",
        });
      }
      if (annualResults.length > 0) detail.annualResults = annualResults;
    }
  }

  // Balance Sheet
  const bsTable = $("#balance-sheet table");
  if (bsTable.length) {
    const bsHeaders: string[] = [];
    bsTable
      .find("thead th")
      .each((_, el) => bsHeaders.push($(el).text().trim()));

    const bsRows = bsTable.find("tbody tr");
    const bsData: Record<string, cheerio.Cheerio<cheerio.Element>> = {};

    bsRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (
        [
          "reserves",
          "borrowing",
          "other liabilities",
          "total liabilities",
          "fixed assets",
          "cwip",
          "total assets",
        ].some((k) => firstCell.includes(k))
      ) {
        bsData[firstCell] = $(el);
      }
    });

    const balanceSheet: StockDetail["balanceSheet"] = [];
    for (let i = 1; i < bsHeaders.length; i++) {
      const getCell = (key: string) =>
        bsData[key] ? bsData[key].find("td").eq(i).text().trim() : "-";
      balanceSheet.push({
        label: bsHeaders[i],
        reserves: getCell("reserves"),
        borrowing: getCell("borrowing"),
        otherLiab: getCell("other liabilities"),
        totalLiab: getCell("total liabilities"),
        fixedAssets: getCell("fixed assets"),
        cwip: getCell("cwip"),
        totalAssets: getCell("total assets"),
      });
    }
    if (balanceSheet.length > 0) detail.balanceSheet = balanceSheet;
  }

  // Cash Flow
  const cfTable = $("#cash-flow table");
  if (cfTable.length) {
    const cfHeaders: string[] = [];
    cfTable
      .find("thead th")
      .each((_, el) => cfHeaders.push($(el).text().trim()));

    const cfRows = cfTable.find("tbody tr");
    let cfOperRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfInvestRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfFinanceRow: cheerio.Cheerio<cheerio.Element> | null = null;

    cfRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("operating") || firstCell.includes("cash from"))
        cfOperRow = $(el);
      if (firstCell.includes("investing")) cfInvestRow = $(el);
      if (firstCell.includes("financing")) cfFinanceRow = $(el);
    });

    if (cfOperRow || cfInvestRow || cfFinanceRow) {
      const cashFlow: StockDetail["cashFlow"] = [];
      for (let i = 1; i < cfHeaders.length; i++) {
        cashFlow.push({
          label: cfHeaders[i],
          operatingCF: cfOperRow
            ? cfOperRow.find("td").eq(i).text().trim()
            : "-",
          investingCF: cfInvestRow
            ? cfInvestRow.find("td").eq(i).text().trim()
            : "-",
          financingCF: cfFinanceRow
            ? cfFinanceRow.find("td").eq(i).text().trim()
            : "-",
        });
      }
      if (cashFlow.length > 0) detail.cashFlow = cashFlow;
    }
  }

  // Shareholding
  const shSection = $("#shareholding");
  if (shSection.length) {
    const shTable = shSection.find("table.data-table");
    if (shTable.length) {
      const shHeaders: string[] = [];
      shTable
        .find("thead th")
        .each((_, el) => shHeaders.push($(el).text().trim()));

      const values: { label: string; value: string }[] = [];
      const seenLabels = new Set<string>();
      shTable.find("tbody tr").each((_, rowEl) => {
        const cells = $(rowEl).find("td");
        if (cells.length < 2) return;
        const label = $(cells[0])
          .text()
          .trim()
          .replace(/\s*[\+\\+]\s*$/, "")
          .trim();
        if (!label || label.length < 2 || seenLabels.has(label)) return;
        seenLabels.add(label);

        let latestValue = "";
        for (let i = cells.length - 1; i >= 1; i--) {
          const val = $(cells[i]).text().trim();
          if (val) {
            latestValue = val;
            break;
          }
        }
        if (latestValue) values.push({ label, value: latestValue });
      });

      if (values.length > 0) {
        const latestPeriod = shHeaders[shHeaders.length - 1] || "Latest";
        detail.shareholding = [{ category: latestPeriod, values }];
      }
    }

    if (!detail.shareholding || detail.shareholding.length === 0) {
      const shItems: { label: string; value: string }[] = [];
      shSection.find("li.flex.flex-space-between").each((_, el) => {
        const label = $(el).find(".name").text().trim();
        const value = $(el).find(".value .number").first().text().trim();
        if (label && value) shItems.push({ label, value });
      });
      if (shItems.length > 0)
        detail.shareholding = [{ category: "Shareholding", values: shItems }];
    }
  }

  // Indices / Benchmarks
  const indices: string[] = [];
  $("#peers #benchmarks a.tag").each((_, el) => {
    const name = $(el).text().trim();
    if (name && !$(el).hasClass("hidden")) indices.push(name);
  });
  if (indices.length > 0) detail.indices = indices;

  // Peers
  const indexKeywords = [
    "nifty",
    "bse",
    "sensex",
    "dollex",
    "cnx",
    "nft",
    "lix",
    "index",
    "benchmark",
    "equal weight",
    "low volatility",
    "value 20",
    "liquid 15",
    "esg",
    "largecap",
    "midcap",
    "commodities",
    "infrastructure",
    "energy",
    "mobility",
  ];

  let sectorUrl = "";
  const sectorLink = $("#peers a[title='Sector']");
  if (sectorLink.length) {
    const href = sectorLink.attr("href") || "";
    if (href.startsWith("/market/")) sectorUrl = href;
  }

  $("#peers a[href^='/company/']").each((_, el) => {
    const $el = $(el);
    const peerName = $el.text().trim();
    const classes = $el.attr("class") || "";
    const href = $el.attr("href") || "";
    const tickerMatch = href.match(/\/company\/([A-Z0-9]+)\//);
    const peerTicker = tickerMatch ? tickerMatch[1] : "";

    if (classes.includes("tag")) return;
    const lower = peerName.toLowerCase();
    if (indexKeywords.some((kw) => lower.includes(kw))) return;

    if (
      peerName &&
      peerName.length > 2 &&
      !peerName.includes("Discretionary") &&
      !peerName.includes("Services") &&
      !peerName.includes("Consumer") &&
      peerName !== "Edit Columns"
    ) {
      detail.peers.push({
        name: peerName,
        ticker:
          peerTicker ||
          peerName.replace(/[^A-Z0-9]/gi, "").toUpperCase(),
      });
    }
  });

  if (detail.peers.length === 0 && sectorUrl) {
    try {
      detail.peers = await fetchSectorPeers(sectorUrl, ticker);
    } catch {
      // Peers are optional
    }
  }

  return detail;
}

async function fetchSectorPeers(
  sectorPath: string,
  currentTicker: string
): Promise<{ name: string; ticker: string }[]> {
  const url = `https://www.screener.in${sectorPath}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return [];

  const html = await res.text();
  const $ = cheerio.load(html);

  const peers: { name: string; ticker: string }[] = [];
  const seen = new Set<string>();

  $("table.data-table a[href^='/company/']").each((_, el) => {
    const $el = $(el);
    const name = $el.text().trim();
    const href = $el.attr("href") || "";
    const tickerMatch = href.match(/\/company\/([A-Z0-9]+)\//);

    if (name && name.length > 2 && tickerMatch) {
      const peerTicker = tickerMatch[1];
      if (/^\d+$/.test(peerTicker)) return;
      if (peerTicker === currentTicker.toUpperCase()) return;
      if (
        ["NIFTY", "CNX100", "CNX500", "CNX200INDE", "CNXCOMMODI"].includes(
          peerTicker
        )
      )
        return;
      if (!seen.has(peerTicker)) {
        seen.add(peerTicker);
        peers.push({ name, ticker: peerTicker });
      }
    }
  });

  return peers.slice(0, 15);
}
