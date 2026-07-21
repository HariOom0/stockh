import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── NSE Stock Universe ──────────────────────────────────────────────
// Nifty 50 + popular F&O + high-liquidity mid/small caps (~150 stocks)
// These are the stocks most likely to show volume shocks.
const NSE_STOCKS: { ticker: string; name: string }[] = [
  // Nifty 50
  { ticker: "RELIANCE", name: "Reliance Industries" },
  { ticker: "TCS", name: "Tata Consultancy Services" },
  { ticker: "HDFCBANK", name: "HDFC Bank" },
  { ticker: "INFY", name: "Infosys" },
  { ticker: "ICICIBANK", name: "ICICI Bank" },
  { ticker: "HINDUNILVR", name: "Hindustan Unilever" },
  { ticker: "SBIN", name: "State Bank of India" },
  { ticker: "BHARTIARTL", name: "Bharti Airtel" },
  { ticker: "ITC", name: "ITC" },
  { ticker: "KOTAKBANK", name: "Kotak Mahindra Bank" },
  { ticker: "LT", name: "Larsen & Toubro" },
  { ticker: "AXISBANK", name: "Axis Bank" },
  { ticker: "WIPRO", name: "Wipro" },
  { ticker: "HCLTECH", name: "HCL Technologies" },
  { ticker: "BAJFINANCE", name: "Bajaj Finance" },
  { ticker: "MARUTI", name: "Maruti Suzuki" },
  { ticker: "SUNPHARMA", name: "Sun Pharma" },
  { ticker: "TATAMOTORS", name: "Tata Motors" },
  { ticker: "TATASTEEL", name: "Tata Steel" },
  { ticker: "ADANIENT", name: "Adani Enterprises" },
  { ticker: "ASIANPAINT", name: "Asian Paints" },
  { ticker: "HINDALCO", name: "Hindalco Industries" },
  { ticker: "TITAN", name: "Titan Company" },
  { ticker: "DMART", name: "Avenue Supermarts" },
  { ticker: "POWERGRID", name: "Power Grid Corp" },
  { ticker: "NTPC", name: "NTPC" },
  { ticker: "ONGC", name: "Oil & Natural Gas Corp" },
  { ticker: "COALINDIA", name: "Coal India" },
  { ticker: "ULTRACEMCO", name: "UltraTech Cement" },
  { ticker: "NESTLEIND", name: "Nestle India" },
  { ticker: "TECHM", name: "Tech Mahindra" },
  { ticker: "BAJAJFINSV", name: "Bajaj Finserv" },
  { ticker: "INDUSINDBK", name: "IndusInd Bank" },
  { ticker: "HDFCLIFE", name: "HDFC Life" },
  { ticker: "SBILIFE", name: "SBI Life" },
  { ticker: "DIVISLAB", name: "Divi's Laboratories" },
  { ticker: "DRREDDY", name: "Dr Reddy's Labs" },
  { ticker: "CIPLA", name: "Cipla" },
  { ticker: "EICHERMOT", name: "Eicher Motors" },
  { ticker: "HEROMOTOCO", name: "Hero MotoCorp" },
  { ticker: "BPCL", name: "Bharat Petroleum" },
  { ticker: "GRASIM", name: "Grasim Industries" },
  { ticker: "APOLLOHOSP", name: "Apollo Hospitals" },
  { ticker: "M_M", name: "Mahindra & Mahindra" },
  { ticker: "BRITANNIA", name: "Britannia Industries" },
  { ticker: "UPL", name: "UPL" },
  { ticker: "JSWSTEEL", name: "JSW Steel" },
  { ticker: "TATACONSUM", name: "Tata Consumer Products" },
  { ticker: "ADANIPORTS", name: "Adani Ports" },
  { ticker: "DLF", name: "DLF" },
  // Popular F&O / High-liquidity stocks
  { ticker: "IRFC", name: "IRFC" },
  { ticker: "RVNL", name: "RVNL" },
  { ticker: "TATAPOWER", name: "Tata Power" },
  { ticker: "YESBANK", name: "Yes Bank" },
  { ticker: "PNB", name: "Punjab National Bank" },
  { ticker: "IDFCFIRSTB", name: "IDFC First Bank" },
  { ticker: "SUZLON", name: "Suzlon Energy" },
  { ticker: "IRCTC", name: "IRCTC" },
  { ticker: "ZOMATO", name: "Zomato" },
  { ticker: "TRENT", name: "Trent" },
  { ticker: "FEDERALBNK", name: "Federal Bank" },
  { ticker: "MANAPPURAM", name: "Manappuram Finance" },
  { ticker: "MUTHOOTFIN", name: "Muthoot Finance" },
  { ticker: "DIXON", name: "Dixon Technologies" },
  { ticker: "DEEPAKNTR", name: "Deepak Nitrite" },
  { ticker: "PCBL", name: "PCBL" },
  { ticker: "KEI", name: "KEI Industries" },
  { ticker: "POLYCAB", name: "Polycab India" },
  { ticker: "KPITTECH", name: "KPIT Technologies" },
  { ticker: "COFORGE", name: "Coforge" },
  { ticker: "PERSISTENT", name: "Persistent Systems" },
  { ticker: "MPHASIS", name: "Mphasis" },
  { ticker: "AFFLE", name: "Affle India" },
  { ticker: "TATAMTRDVR", name: "Tata Motors DVR" },
  { ticker: "BANDHANBNK", name: "Bandhan Bank" },
  { ticker: "IBULHSGFIN", name: "Indiabulls Housing" },
  { ticker: "NIFTYBEES", name: "Nippon India ETF" },
  { ticker: "JIOFIN", name: "Jio Financial Services" },
  { ticker: "HDFCAMC", name: "HDFC AMC" },
  { ticker: "BAJAJAUTO", name: "Bajaj Auto" },
  { ticker: "BERGEPAINT", name: "Berger Paints" },
  { ticker: "DABUR", name: "Dabur India" },
  { ticker: "GODREJCP", name: "Godrej Consumer Products" },
  { ticker: "HINDPETRO", name: "HPCL" },
  { ticker: "IOC", name: "Indian Oil Corp" },
  { ticker: "PIDILITIND", name: "Pidilite Industries" },
  { ticker: "TITAGARH", name: "Titagarh Rail Systems" },
  { ticker: "VBL", name: "Varun Beverages" },
  { ticker: "COROMANDEL", name: "Coromandel International" },
  { ticker: "EDELWEISS", name: "Edelweiss Financial" },
  { ticker: "RECLTD", name: "REC" },
  { ticker: "PFC", name: "PFC" },
  { ticker: "NATIONALUM", name: "National Aluminium" },
  { ticker: "CUMMINSIND", name: "Cummins India" },
  { ticker: "VOLTAS", name: "Voltas" },
  { ticker: "EMAMILTD", name: "Emami" },
  { ticker: "GLAXO", name: "GlaxoSmithKline Pharma" },
  { ticker: "LALPATHLAB", name: "Lal PathLabs" },
  { ticker: "AUBANK", name: "AU Small Finance Bank" },
  { ticker: "CHOLAFIN", name: "Cholamandalam Finance" },
  { ticker: "SHRIRAMFIN", name: "Shriram Finance" },
  { ticker: "MOTHERSUMI", name: "Mother Sumi" },
  { ticker: "TORNTPOWER", name: "Torrent Power" },
  { ticker: "TATAELXSI", name: "Tata Elxsi" },
  { ticker: "LTIEMIND", name: "LTIMindtree" },
  { ticker: "L&TFH", name: "L&T Finance Holdings" },
  { ticker: "HONAUT", name: "Honda India Power" },
  { ticker: "TVSMOTOR", name: "TVS Motor Company" },
  { ticker: "MRF", name: "MRF" },
  { ticker: "BOSCHLTD", name: "Bosch" },
  { ticker: "PAGEIND", name: "Page Industries" },
  { ticker: "3MINDIA", name: "3M India" },
  { ticker: "SIEMENS", name: "Siemens" },
  { ticker: "ABB", name: "ABB India" },
  { ticker: "HONEYWELL", name: "Honeywell Automation" },
  { ticker: "SKFINDIA", name: "SKF India" },
  { ticker: "TIMKEN", name: "Timken India" },
  { ticker: "SNOWMAN", name: "Snowman Logistics" },
  { ticker: "SPARC", name: "Sparc Systems" },
  { ticker: "DATAPATTNS", name: "Data Patterns" },
  { ticker: "CIGNITI", name: "Cigniti Technologies" },
  { ticker: "LTTS", name: "L&T Technology Services" },
  { ticker: "RAJESHEXPO", name: "Rajesh Exports" },
  { ticker: "JINDALSTEL", name: "Jindal Steel" },
  { ticker: "VEDL", name: "Vedanta" },
  { ticker: "HINDZINC", name: "Hindustan Zinc" },
  { ticker: "NMDC", name: "NMDC" },
  { ticker: "NALCO", name: "NALCO" },
  { ticker: "SRF", name: "SRF" },
  { ticker: "INDIAMART", name: "IndiaMART InterMESH" },
  { ticker: "JUSTDIAL", name: "Just Dial" },
  { ticker: "TRIDENT", name: "Trident" },
  { ticker: "VIPIND", name: "VIP Industries" },
  { ticker: "JBM", name: "JBM Auto" },
  { ticker: "ENDURANCE", name: "Endurance Technologies" },
  { ticker: "SONATSOFTW", name: "Sonata Software" },
  { ticker: "INTELLECT", name: "Intellect Design Arena" },
  { ticker: "TRIVENI", name: "Triveni Engineering" },
  { ticker: "ATUL", name: "Atul" },
  { ticker: "AARTIDRUG", name: "Aarti Drugs" },
  { ticker: "LAURUSLABS", name: "Laurus Labs" },
  { ticker: "STRTECH", name: "Stratech" },
  { ticker: "CAPLIPOINT", name: "Caplin Point Labs" },
  { ticker: "GRANULES", name: "Granules India" },
  { ticker: "TORNTPHARM", name: "Torrent Pharma" },
  { ticker: "ALKEM", name: "Alkem Labs" },
  { ticker: "LUPIN", name: "Lupin" },
  { ticker: "BIOCON", name: "Biocon" },
  { ticker: "ALEMBICLTD", name: "Alembic Pharma" },
  { ticker: "THERMAX", name: "Thermax" },
  { ticker: "WELCORP", name: "Welspun Corp" },
  { ticker: "ARVIND", name: "Arvind" },
  { ticker: "RAYMOND", name: "Raymond" },
  { ticker: "VARDMRL", name: "Vardhman Textiles" },
  { ticker: "WELSPUNLIV", name: "Welspun Living" },
  { ticker: "CENTURYPLY", name: "Century Plyboards" },
  { ticker: "GREENPLY", name: "GreenPly Industries" },
  { ticker: "AIAENG", name: "AIA Engineering" },
  { ticker: "BALAMINES", name: "Balaji Amines" },
  { ticker: "SOLARINDS", name: "Solar Industries" },
  { ticker: "HIMADRI", name: "Himadri Speciality" },
  { ticker: "GRAPHITE", name: "Graphite India" },
  { ticker: "IGL", name: "Indraprastha Gas" },
  { ticker: "MGL", name: "Mahanagar Gas" },
  { ticker: "GUJGASLTD", name: "Gujarat Gas" },
  { ticker: "PETRONET", name: "Petronet LNG" },
  { ticker: "GAIL", name: "GAIL India" },
  { ticker: "CONCOR", name: "Container Corp" },
];

// Deduplicate by ticker
const STOCK_MAP = new Map<string, string>();
for (const s of NSE_STOCKS) {
  if (!STOCK_MAP.has(s.ticker)) STOCK_MAP.set(s.ticker, s.name);
}

export interface VolumeShockerStock {
  sr: number;
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
}

interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice?: number;
    previousClose?: number;
  };
  timestamp: number[];
  indicators: {
    quote: {
      close: (number | null)[];
      volume: (number | null)[];
    }[];
  };
}

/**
 * Fetch 5-day OHLCV data for tickers from Yahoo Finance v8 API.
 * Uses concurrent individual requests (batch endpoint is deprecated).
 */
async function fetchYahooData(
  tickers: string[]
): Promise<Map<string, { closes: number[]; volumes: number[] }>> {
  const results = new Map<string, { closes: number[]; volumes: number[] }>();
  const CONCURRENCY = 15; // Max parallel requests

  // Process in chunks to avoid rate limits
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);

    const chunkResults = await Promise.allSettled(
      chunk.map(async (ticker) => {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}.NS?range=5d&interval=1d&includePrePost=false`;

        const resp = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json();
        const result: YahooChartResult = data.chart?.result?.[0];
        if (!result) throw new Error("No result");

        const closes = result.indicators.quote[0].close.filter(
          (c): c is number => c !== null
        );
        const volumes = result.indicators.quote[0].volume.filter(
          (v): v is number => v !== null
        );

        return { ticker, closes, volumes };
      })
    );

    for (const r of chunkResults) {
      if (r.status === "fulfilled") {
        results.set(r.value.ticker, {
          closes: r.value.closes,
          volumes: r.value.volumes,
        });
      }
      // Silently skip failures (404 = delisted/invalid symbol)
    }
  }

  return results;
}

/**
 * Fetch volume shockers using Yahoo Finance data.
 * Compares latest trading day vs previous day to find volume spikes.
 */
async function fetchViaYahoo(): Promise<VolumeShockerStock[]> {
  const tickers = Array.from(STOCK_MAP.keys());
  console.log(`[Scraper] Scanning ${tickers.length} stocks via Yahoo Finance...`);

  const yahooData = await fetchYahooData(tickers);
  console.log(`[Scraper] Got data for ${yahooData.size}/${tickers.length} stocks`);

  const results: VolumeShockerStock[] = [];

  for (const [ticker, { closes, volumes }] of yahooData) {
    if (closes.length < 2 || volumes.length < 2) continue;

    const latestClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const latestVol = volumes[volumes.length - 1];
    const prevVol = volumes[volumes.length - 2];

    if (prevClose <= 0 || prevVol <= 0 || latestClose <= 0) continue;

    const changePct = ((latestClose / prevClose) - 1) * 100;
    const volGainPct = ((latestVol / prevVol) - 1) * 100;

    // Volume shocker: positive price change AND volume gain >= 100%
    if (changePct > 0 && volGainPct >= 100) {
      results.push({
        sr: 0, // Will be assigned after sorting
        name: STOCK_MAP.get(ticker) || ticker,
        ticker,
        close: Math.round(latestClose * 100) / 100,
        change: Math.round(changePct * 100) / 100,
        volGainPct: Math.round(volGainPct * 10) / 10,
        isPositive: true,
      });
    }
  }

  // Sort by volume gain percentage (highest first)
  results.sort((a, b) => b.volGainPct - a.volGainPct);

  // Assign serial numbers
  results.forEach((r, i) => (r.sr = i + 1));

  console.log(
    `[Scraper] Found ${results.length} volume shockers (vol gain >= 100%)`
  );

  return results;
}

/**
 * Fetch volume shockers — tries Yahoo Finance API.
 */
export async function fetchVolumeShockers(): Promise<VolumeShockerStock[]> {
  return fetchViaYahoo();
}

// ═══════════════════════════════════════════════════════════════════════
// Stock Detail Scraper (Screener.in) — unchanged, still works
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