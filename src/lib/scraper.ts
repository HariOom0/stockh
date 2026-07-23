import * as cheerio from "cheerio";
import { execSync } from "child_process";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ─── Chartink EOD Scanner URL (the page the user wants to match) ─────
const CHARTINK_EOD_URL =
  "https://chartink.com/eodscanner/Volume-Shockers.html";

// ─── Path to the Python scraper script ─────
const PYTHON_SCRAPER_PATH = "/opt/render/project/src/scripts/scrape_chartink.py";

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

// ═══════════════════════════════════════════════════════════════════════
// Method 1: Python subprocess with curl_cffi (bypasses Cloudflare TLS)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Scrape the Chartink EOD Volume Shockers page using a Python subprocess
 * with curl_cffi which mimics Chrome's TLS fingerprint to bypass Cloudflare.
 *
 * Why Python? Node.js doesn't have a reliable TLS-impersonation library.
 * curl_cffi (Python) uses the same approach as curl-impersonate to perfectly
 * mimic Chrome's TLS handshake, JA3, and HTTP/2 fingerprints.
 *
 * Fallback: If the pre-compiled Python binary isn't available, falls back
 * to direct Node.js fetch (may be blocked by Cloudflare).
 */
async function fetchViaPythonSubprocess(): Promise<VolumeShockerStock[]> {
  console.log("[Chartink] Attempting Python curl_cffi scraper...");

  // Try the pre-compiled binary first, then system python3
  const pythonPaths = [
    "/opt/render/project/src/scripts/scrape_chartink.elf",
    PYTHON_SCRAPER_PATH,
  ];

  let result: string | null = null;

  for (const pyPath of pythonPaths) {
    try {
      let cmd: string;
      if (pyPath.endsWith(".elf")) {
        // Pre-compiled standalone binary — run directly
        cmd = `"${pyPath}" "${CHARTINK_EOD_URL}"`;
      } else {
        // Python script — run with system python3
        cmd = `python3 "${pyPath}" "${CHARTINK_EOD_URL}"`;
      }

      console.log(`[Chartink] Trying: ${cmd}`);
      result = execSync(cmd, {
        encoding: "utf8",
        timeout: 45_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      if (result) break;
    } catch (err: any) {
      console.warn(
        `[Chartink] Python path ${pyPath} failed: ${err.message?.substring(0, 200)}`
      );
    }
  }

  if (!result) {
    console.warn("[Chartink] All Python scraper paths failed");
    return [];
  }

  // Parse JSON output
  try {
    const data = JSON.parse(result.trim());
    if (!Array.isArray(data)) {
      console.warn("[Chartink] Python scraper returned non-array:", typeof data);
      return [];
    }

    const stocks: VolumeShockerStock[] = data
      .filter(
        (s: any) => s.ticker && s.name && s.close && s.close > 0
      )
      .map((s: any, i: number) => ({
        sr: i + 1,
        name: String(s.name || ""),
        ticker: String(s.ticker || ""),
        close: Number(s.close) || 0,
        change: Number(s.change) || 0,
        volGainPct: Number(s.volGainPct) || 0,
        isPositive: (Number(s.change) || 0) > 0,
      }));

    console.log(`[Chartink] Python scraper returned ${stocks.length} stocks`);
    return stocks;
  } catch (parseErr: any) {
    console.error(`[Chartink] Failed to parse Python output: ${parseErr.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Method 2: Direct Node.js fetch with browser headers (Cloudflare may block)
// ═══════════════════════════════════════════════════════════════════════

async function fetchViaNodeFetch(): Promise<VolumeShockerStock[]> {
  console.log("[Chartink] Attempting direct Node.js fetch...");

  try {
    const resp = await fetch(CHARTINK_EOD_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Ch-Ua":
          '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      console.warn(`[Chartink] Fetch returned ${resp.status}`);
      return [];
    }

    const html = await resp.text();

    if (!html.includes("stocklisttable")) {
      console.warn(
        "[Chartink] Fetch succeeded but no stock table (Cloudflare challenge)"
      );
      return [];
    }

    return parseChartinkHTML(html);
  } catch (err: any) {
    console.warn(`[Chartink] Node.js fetch failed: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HTML Parser (shared by all methods)
// ═══════════════════════════════════════════════════════════════════════

function parseChartinkHTML(html: string): VolumeShockerStock[] {
  const $ = cheerio.load(html);
  const stocks: VolumeShockerStock[] = [];

  $("#stocklisttable tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    const link = cells.eq(1).find("a[href*='/stocks/']");
    if (link.length === 0) return;

    const href = link.attr("href") || "";
    const tickerMatch = href.match(/\/stocks\/([A-Z0-9]+)\.html/);
    if (!tickerMatch) return;

    const ticker = tickerMatch[1];
    const name = (link.text().trim() || "").replace(
      /\s*(Ltd|Limited)\.?\s*$/i,
      ""
    );

    const closeText = cells.eq(3).text().trim();
    const changeText = cells.eq(4).text().trim();
    const volText = cells.eq(5).text().trim();

    const close = parseFloat(closeText) || 0;
    // Change format: [16.9%] or [-5.2%]
    const changeMatch = changeText.match(/([+-]?[\d.]+)%/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    // Vol Gain format: 367.75%
    const volMatch = volText.match(/([\d.]+)%/);
    const volGainPct = volMatch ? parseFloat(volMatch[1]) : 0;

    if (ticker && name && close > 0) {
      stocks.push({
        sr: 0,
        name,
        ticker,
        close,
        change,
        volGainPct,
        isPositive: change > 0,
      });
    }
  });

  // Assign serial numbers
  stocks.forEach((s, i) => (s.sr = i + 1));

  return stocks;
}

// ═══════════════════════════════════════════════════════════════════════
// Main: fetchVolumeShockers — tries multiple methods
// ═══════════════════════════════════════════════════════════════════════

export async function fetchVolumeShockers(): Promise<VolumeShockerStock[]> {
  // Method 1: Python curl_cffi (most reliable for Cloudflare bypass)
  try {
    const stocks = await fetchViaPythonSubprocess();
    if (stocks.length > 0) {
      console.log(
        `[Scraper] Returning ${stocks.length} stocks from Python curl_cffi`
      );
      return stocks;
    }
  } catch (err: any) {
    console.error(`[Scraper] Python method failed: ${err.message}`);
  }

  // Method 2: Direct Node.js fetch (may be blocked by Cloudflare)
  try {
    const stocks = await fetchViaNodeFetch();
    if (stocks.length > 0) {
      console.log(
        `[Scraper] Returning ${stocks.length} stocks from Node.js fetch`
      );
      return stocks;
    }
  } catch (err: any) {
    console.error(`[Scraper] Node.js fetch failed: ${err.message}`);
  }

  console.warn("[Scraper] All scraping methods failed");
  return [];
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