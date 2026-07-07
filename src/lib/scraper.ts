import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface VolumeShockerStock {
  sr: number;
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
}

export async function fetchVolumeShockers(): Promise<VolumeShockerStock[]> {
  const url = "https://chartink.com/eodscanner/Volume-Shockers.html";
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Failed to fetch chartink: ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const stocks: VolumeShockerStock[] = [];

  $("#stocklisttable tbody tr").each((_, el) => {
    const $row = $(el);
    const cells = $row.find("td.stocklistbo");

    if (cells.length < 6) return;

    const sr = parseInt($(cells[0]).text().trim(), 10);
    if (isNaN(sr)) return; // Skip header row

    const nameAnchor = $(cells[1]).find("a");
    const name = nameAnchor.text().trim();
    const href = nameAnchor.attr("href") || "";
    // Extract ticker from URL like /stocks/TAJGVK.html
    const tickerMatch = href.match(/\/stocks\/([A-Z0-9]+)\.html/);
    const ticker = tickerMatch ? tickerMatch[1] : "";

    const closeText = $(cells[3]).text().trim().replace(/,/g, "");
    const close = parseFloat(closeText);

    // Parse change - format: [5.43%] or [-3.21%]
    const changeHtml = $(cells[4]).html() || "";
    const changeText = $(cells[4]).text().trim();
    const changeMatch = changeText.match(/\[([-\d.]+)%\]/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    // Check HTML for color="green" attribute (text() strips HTML tags)
    const isPositive = changeHtml.includes("green") || change > 0;

    const volGainText = $(cells[5]).text().trim().replace(/%/g, "");
    const volGainPct = parseFloat(volGainText);

    if (!isNaN(close) && !isNaN(change) && !isNaN(volGainPct)) {
      stocks.push({ sr, name, ticker, close, change, volGainPct, isPositive });
    }
  });

  return stocks;
}

export interface StockDetail {
  name: string;
  ticker: string;
  bseCode?: string;
  nseCode?: string;
  sector?: string;
  industry?: string;
  about?: string;
  metrics: Record<string, string>;
  quarters: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  peers: string[];
  // Extended data
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

  // BSE / NSE codes from the company info area
  const companyInfoText = $(".company-info-strip").text() || "";
  const bseMatch = companyInfoText.match(/BSE:\s*(\d+)/);
  const nseMatch = companyInfoText.match(/NSE:\s*(\w+)/);
  if (bseMatch) detail.bseCode = bseMatch[1];
  if (nseMatch) detail.nseCode = nseMatch[1];

  // Sector & Industry from peers section (more reliably present)
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

  // About section
  detail.about = $(".about p")
    .first()
    .text()
    .trim()
    .replace(/\s+/g, " ");

  // ─── Key metrics from the top ratios section ────────────────────────
  const ratioRows = $("#top-ratios li.flex.flex-space-between");
  ratioRows.each((_, el) => {
    const labelEl = $(el).find(".name");
    const valueEl = $(el).find(".value .number");
    const label = labelEl.text().trim();
    const value = valueEl.first().text().trim();
    if (label && value) {
      detail.metrics[label] = value;
    }
  });

  // ─── Pros & Cons ───────────────────────────────────────────────────
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

  // ─── Quarterly results table ────────────────────────────────────────
  const quarterlyTable = $("#quarters table");
  if (quarterlyTable.length) {
    const headers: string[] = [];
    quarterlyTable.find("thead th").each((_, el) => {
      headers.push($(el).text().trim());
    });

    // Find row indices for Sales, Net Profit, and OPM
    const rows = quarterlyTable.find("tbody tr");
    let salesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let profitRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let opmRow: cheerio.Cheerio<cheerio.Element> | null = null;

    rows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue")) {
        salesRow = $(el);
      }
      if (firstCell.includes("net profit") || firstCell.includes("profit for")) {
        profitRow = $(el);
      }
      if (firstCell.includes("opm") || firstCell.includes("operating")) {
        opmRow = $(el);
      }
    });

    // Build quarter data (skip first header column)
    for (let i = 1; i < headers.length; i++) {
      const q: StockDetail["quarters"][number] = {
        label: headers[i],
        sales: salesRow ? salesRow.find("td").eq(i).text().trim() : "-",
        netProfit: profitRow ? profitRow.find("td").eq(i).text().trim() : "-",
        opm: opmRow ? opmRow.find("td").eq(i).text().trim() : "-",
      };
      detail.quarters.push(q);
    }
  }

  // ─── Annual results (compounded sales/profit growth) ────────────────
  // Screener.in shows a "Compounded Sales Growth" and "Compounded Profit Growth" section
  // Also the "Financials > Quarterly Results" table has yearly data
  const annualTable = $("table#annual-results-table, #annual table");
  if (annualTable.length) {
    const annHeaders: string[] = [];
    annualTable.find("thead th").each((_, el) => {
      annHeaders.push($(el).text().trim());
    });

    const annRows = annualTable.find("tbody tr");
    let annSalesRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let annProfitRow: cheerio.Cheerio<cheerio.Element> | null = null;

    annRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("sales") || firstCell.includes("revenue")) {
        annSalesRow = $(el);
      }
      if (firstCell.includes("net profit") || firstCell.includes("profit for")) {
        annProfitRow = $(el);
      }
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

  // ─── Balance Sheet data ────────────────────────────────────────────
  const bsTable = $("#balance-sheet table");
  if (bsTable.length) {
    const bsHeaders: string[] = [];
    bsTable.find("thead th").each((_, el) => {
      bsHeaders.push($(el).text().trim());
    });

    const bsRows = bsTable.find("tbody tr");
    const bsData: Record<string, cheerio.Cheerio<cheerio.Element>> = {};

    bsRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (
        firstCell.includes("reserves") ||
        firstCell.includes("borrowing") ||
        firstCell.includes("other liabilities") ||
        firstCell.includes("total liabilities") ||
        firstCell.includes("fixed assets") ||
        firstCell.includes("cwip") ||
        firstCell.includes("total assets")
      ) {
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

  // ─── Cash Flow data ────────────────────────────────────────────────
  const cfTable = $("#cash-flow table");
  if (cfTable.length) {
    const cfHeaders: string[] = [];
    cfTable.find("thead th").each((_, el) => {
      cfHeaders.push($(el).text().trim());
    });

    const cfRows = cfTable.find("tbody tr");
    let cfOperRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfInvestRow: cheerio.Cheerio<cheerio.Element> | null = null;
    let cfFinanceRow: cheerio.Cheerio<cheerio.Element> | null = null;

    cfRows.each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell.includes("operating") || firstCell.includes("cash from")) {
        cfOperRow = $(el);
      }
      if (firstCell.includes("investing")) {
        cfInvestRow = $(el);
      }
      if (firstCell.includes("financing")) {
        cfFinanceRow = $(el);
      }
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

  // ─── Shareholding pattern ───────────────────────────────────────────
  const shSection = $("#shareholding");
  if (shSection.length) {
    const shTable = shSection.find("table.data-table");
    if (shTable.length) {
      const shHeaders: string[] = [];
      shTable.find("thead th").each((_, el) => {
        shHeaders.push($(el).text().trim());
      });

      // Build a single shareholding entry with periods as columns
      const values: { label: string; value: string }[] = [];
      const seenLabels = new Set<string>();
      shTable.find("tbody tr").each((_, rowEl) => {
        const cells = $(rowEl).find("td");
        if (cells.length < 2) return;
        const label = $(cells[0]).text().trim().replace(/\s*[\+\\+]\s*$/, "").trim();
        if (!label || label.length < 2 || seenLabels.has(label)) return;
        seenLabels.add(label);

        // Get the latest period value (last non-empty cell)
        let latestValue = "";
        for (let i = cells.length - 1; i >= 1; i--) {
          const val = $(cells[i]).text().trim();
          if (val) { latestValue = val; break; }
        }
        if (latestValue) {
          values.push({ label, value: latestValue });
        }
      });

      if (values.length > 0) {
        // Use the latest period from headers as category
        const latestPeriod = shHeaders[shHeaders.length - 1] || "Latest";
        detail.shareholding = [{ category: latestPeriod, values }];
      }
    }

    // Fallback: look for list-style format
    if (!detail.shareholding || detail.shareholding.length === 0) {
      const shItems: { label: string; value: string }[] = [];
      shSection.find("li.flex.flex-space-between").each((_, el) => {
        const label = $(el).find(".name").text().trim();
        const value = $(el).find(".value .number").first().text().trim();
        if (label && value) {
          shItems.push({ label, value });
        }
      });
      if (shItems.length > 0) {
        detail.shareholding = [{ category: "Shareholding", values: shItems }];
      }
    }
  }

  // ─── Peers ─────────────────────────────────────────────────────────
  $("#peers a[href^='/company/']").each((_, el) => {
    const peerName = $(el).text().trim();
    // Filter out category-like entries
    if (
      peerName &&
      peerName.length > 2 &&
      !peerName.includes("Discretionary") &&
      !peerName.includes("Services") &&
      !peerName.includes("Consumer") &&
      peerName !== "Edit Columns"
    ) {
      detail.peers.push(peerName);
    }
  });

  return detail;
}