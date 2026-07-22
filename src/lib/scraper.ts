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
// Chartink Scraper (Primary Data Source)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch volume shockers from Chartink.
 * Two-step process: GET page for cookies, then POST with XSRF token.
 * Key: must send URL-encoded XSRF cookie value, and URL-decoded value in header.
 */
async function fetchChartinkStocks(): Promise<ChartinkRow[]> {
  // Step 1: GET the screener page to obtain session cookies
  const pageRes = await fetch(CHARTINK_PAGE, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });

  if (!pageRes.ok) {
    throw new Error(`Chartink page fetch failed: ${pageRes.status}`);
  }

  // Extract raw (URL-encoded) cookie values from Set-Cookie headers
  const setCookieHeaders = pageRes.headers.getSetCookie?.() ?? [];
  let rawXsrf = "";
  let rawCiSession = "";

  for (const h of setCookieHeaders) {
    const m1 = h.match(/XSRF-TOKEN=(.+?);/);
    if (m1) rawXsrf = m1[1];
    const m2 = h.match(/ci_session=(.+?);/);
    if (m2) rawCiSession = m2[1];
  }

  if (!rawXsrf || !rawCiSession) {
    throw new Error("Chartink: failed to extract XSRF-TOKEN or ci_session cookies");
  }

  // Step 2: POST to screener/process with proper headers
  // - Cookie header: raw URL-encoded values (as the browser sends them)
  // - X-XSRF-TOKEN header: URL-decoded value
  const decodedXsrf = decodeURIComponent(rawXsrf);

  const postRes = await fetch(CHARTINK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `ci_session=${rawCiSession}; XSRF-TOKEN=${rawXsrf}`,
      "X-XSRF-TOKEN": decodedXsrf,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
      Referer: CHARTINK_PAGE,
      "User-Agent": USER_AGENT,
    },
    body: `scan_clause=${encodeURIComponent(CHARTINK_SCAN_CLAUSE)}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!postRes.ok) {
    throw new Error(`Chartink API failed: ${postRes.status}`);
  }

  const json = await postRes.json();
  const data: ChartinkRow[] = json.data ?? [];
  console.log(`[Chartink] Fetched ${data.length} stocks (recordsTotal: ${json.recordsTotal})`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// Yahoo Finance — 20-day Volume Average (for volGainPct calculation)
// ═══════════════════════════════════════════════════════════════════════

interface YahooChartResult {
  avgVol20d: number;
  todayVolume: number;
  prevClose: number;
  todayClose: number;
}

/**
 * Fetch 1-month chart data from Yahoo Finance and calculate 20-day volume average.
 */
async function fetchYahooVolAvg(ticker: string): Promise<YahooChartResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS?range=1mo&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
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
    const closes: number[] = (quote.close ?? []).filter(
      (c: number | null) => c !== null
    );

    if (volumes.length < 5) return null;

    const todayVolume = volumes[volumes.length - 1];
    // Previous 20 trading days (or all available if < 20)
    const prevVols = volumes.slice(-21, -1); // exclude today, take up to 20
    const avgVol20d =
      prevVols.length > 0
        ? prevVols.reduce((a, b) => a + b, 0) / prevVols.length
        : todayVolume;

    const todayClose = closes[closes.length - 1] ?? 0;
    const prevClose = closes[closes.length - 2] ?? todayClose;

    return { avgVol20d, todayVolume, prevClose, todayClose };
  } catch {
    return null;
  }
}

/**
 * Fetch volume averages for multiple tickers with concurrency control.
 */
async function fetchVolumeAverages(
  tickers: string[],
  concurrency = 8
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
  await Promise.all(workers);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// Main: fetchVolumeShockers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch volume shockers — Chartink primary, Yahoo for volume averages.
 */
export async function fetchVolumeShockers(): Promise<VolumeShockerStock[]> {
  // Step 1: Get stock list from Chartink
  const chartinkData = await fetchChartinkStocks();

  if (chartinkData.length === 0) return [];

  // Step 2: Get 20-day volume averages from Yahoo Finance (for volGainPct)
  const tickers = chartinkData.map((s) => s.nsecode);
  console.log(
    `[Scraper] Fetching volume averages for ${tickers.length} stocks from Yahoo...`
  );
  const volAvgs = await fetchVolumeAverages(tickers);
  console.log(
    `[Scraper] Got volume averages for ${volAvgs.size}/${tickers.length} stocks`
  );

  // Step 3: Merge data — use Chartink for close/change, Yahoo for volGainPct only
  const results: VolumeShockerStock[] = chartinkData.map((row, idx) => {
    const yahoo = volAvgs.get(row.nsecode);
    let volGainPct: number;

    if (yahoo && yahoo.avgVol20d > 0) {
      // Use Yahoo data for accurate volume gain calculation
      volGainPct = Math.round(((yahoo.todayVolume / yahoo.avgVol20d) - 1) * 1000) / 10;
    } else {
      // Fallback: estimate as minimum 500% (scan requires > 5x)
      volGainPct = 500;
    }

    // Clean up company name (remove ".Ltd", ".Limited" etc)
    const name = row.name
      .replace(/\s*(Ltd|Limited)\.?\s*$/i, "")
      .trim();

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

  // Sort by volGainPct (highest first)
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

  if (!res.ok) throw new Error(`Failed to fetch screener for ${ticker}: ${res.status}`);

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
  detail.name = $("h1.h2")
    .first()
    .text()
    .trim()
    .replace(/\s+/g, " ");

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
  detail.about = $(".about p")
    .first()
    .text()
    .trim()
    .replace(/\s+/g, " ");

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
    quarterlyTable.find("thead th").each((_, el) => headers.push($(el).text().trim()));

    const rows = quarterlyTable.find("tbody tr");
    let salesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let profitRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let opmRow: cheerio.Cheerio<cheerio.Element> | null = null;

    rows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue")) salesRow = $(el);
      if (firstCell.includes("net profit") || firstCell.includes("profit for")) profitRow = $(el);
      if (firstCell.includes("opm") || firstCell.includes("operating")) opmRow = $(el);
    });

    for (let i = 1; i < headers.length; i++) {
      detail.quarters.push({
        label: headers[i],
        sales: salesRow ? salesRow.find("td").eq(i).text().trim() : "-",
        netProfit: profitRow ? profitRow.find("td").eq(i).text().trim() : "-",
        opm: opmRow ? opmRow.find("td").eq(i).text().trim() : "-",
      });
    }
  }

  // Annual results
  const annualTable = $("table#annual-results-table, #annual table");
  if (annualTable.length) {
    const annHeaders: string[] = [];
    annualTable.find("thead th").each((_, el) => annHeaders.push($(el).text().trim()));

    const annRows = annualTable.find("tbody tr");
    let annSalesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let annProfitRow: cheerio.Cheerio<cheerio.Element> | null = null;

    annRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue")) annSalesRow = $(el);
      if (firstCell.includes("net profit") || firstCell.includes("profit for")) annProfitRow = $(el);
    });

    if (annSalesRow || annProfitRow) {
      const annualResults: StockDetail["annualResults"] = [];
      for (let i = 1; i < annHeaders.length; i++) {
        annualResults.push({
          label: annHeaders[i],
          sales: annSalesRow ? annSalesRow.find("td").eq(i).text().trim() : "-",
          netProfit: annProfitRow ? annProfitRow.find("td").eq(i).text().trim() : "-",
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
    bsTable.find("thead th").each((_, el) => bsHeaders.push($(el).text().trim()));

    const bsRows = bsTable.find("tbody tr");
    const bsData: Record<string, cheerio.Cheerio<cheerio.Element>> = {};

    bsRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (["reserves", "borrowing", "other liabilities", "total liabilities", "fixed assets", "cwip", "total assets"].some(k => firstCell.includes(k))) {
        bsData[firstCell] = $(el);
      }
    });

    const balanceSheet: StockDetail["balanceSheet"] = [];
    for (let i = 1; i < bsHeaders.length; i++) {
      const getCell = (key: string) => bsData[key] ? bsData[key].find("td").eq(i).text().trim() : "-";
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
    cfTable.find("thead th").each((_, el) => cfHeaders.push($(el).text().trim()));

    const cfRows = cfTable.find("tbody tr");
    let cfOperRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfInvestRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfFinanceRow: cheerio.Cheerio<cheerio.Element> | null = null;

    cfRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("operating") || firstCell.includes("cash from")) cfOperRow = $(el);
      if (firstCell.includes("investing")) cfInvestRow = $(el);
      if (firstCell.includes("financing")) cfFinanceRow = $(el);
    });

    if (cfOperRow || cfInvestRow || cfFinanceRow) {
      const cashFlow: StockDetail["cashFlow"] = [];
      for (let i = 1; i < cfHeaders.length; i++) {
        cashFlow.push({
          label: cfHeaders[i],
          operatingCF: cfOperRow ? cfOperRow.find("td").eq(i).text().trim() : "-",
          investingCF: cfInvestRow ? cfInvestRow.find("td").eq(i).text().trim() : "-",
          financingCF: cfFinanceRow ? cfFinanceRow.find("td").eq(i).text().trim() : "-",
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
      shTable.find("thead th").each((_, el) => shHeaders.push($(el).text().trim()));

      const values: { label: string; value: string }[] = [];
      const seenLabels = new Set<string>();
      shTable.find("tbody tr").each((_, rowEl) => {
        const cells = $(rowEl).find("td");
        if (cells.length < 2) return;
        const label = $(cells[0]).text().trim().replace(/\s*[\+\\+]\s*$/, "").trim();
        if (!label || label.length < 2 || seenLabels.has(label)) return;
        seenLabels.add(label);

        let latestValue = "";
        for (let i = cells.length - 1; i >= 1; i--) {
          const val = $(cells[i]).text().trim();
          if (val) { latestValue = val; break; }
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
      if (shItems.length > 0) detail.shareholding = [{ category: "Shareholding", values: shItems }];
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
    "nifty", "bse", "sensex", "dollex", "cnx", "nft", "lix",
    "index", "benchmark", "equal weight", "low volatility",
    "value 20", "liquid 15", "esg", "largecap", "midcap",
    "commodities", "infrastructure", "energy", "mobility",
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

    if (peerName && peerName.length > 2 && !peerName.includes("Discretionary") && !peerName.includes("Services") && !peerName.includes("Consumer") && peerName !== "Edit Columns") {
      detail.peers.push({ name: peerName, ticker: peerTicker || peerName.replace(/[^A-Z0-9]/gi, "").toUpperCase() });
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

async function fetchSectorPeers(sectorPath: string, currentTicker: string): Promise<{ name: string; ticker: string }[]> {
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
      if (["NIFTY", "CNX100", "CNX500", "CNX200INDE", "CNXCOMMODI"].includes(peerTicker)) return;
      if (!seen.has(peerTicker)) {
        seen.add(peerTicker);
        peers.push({ name, ticker: peerTicker });
      }
    }
  });

  return peers.slice(0, 15);
}
