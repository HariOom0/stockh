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

  // Key metrics from the top ratios section
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

  // Quarterly results table
  const quarterlyTable = $("#quarters table");
  if (quarterlyTable.length) {
    const headers: string[] = [];
    quarterlyTable.find("thead th").each((_, el) => {
      headers.push($(el).text().trim());
    });

    // Find row indices for Sales and Net Profit
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

  // Peers - loaded dynamically, skip category names
  // The peers table has a placeholder "Loading peers table..."
  // We look for peer links that point to /company/ paths
  $("#peers a[href^='/company/']").each((_, el) => {
    const peerName = $(el).text().trim();
    // Filter out category-like entries (no spaces, or known categories)
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