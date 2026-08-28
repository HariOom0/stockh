// Run with: node scripts/scrape-chartink-27th.js
// Scrapes Chartink via agent-browser and pushes to DB for Aug 27

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Scrape Chartink via a CORS proxy or direct
async function scrapeChartink() {
  // Use allorigins as CORS proxy
  const chartinkUrl = 'https://chartink.com/eodscanner/Volume-Shockers.html';
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(chartinkUrl)}`;
  
  console.log('Fetching via CORS proxy...');
  const res = await fetch(proxyUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
  const html = await res.text();
  
  if (!html.includes('stocklisttable')) throw new Error('No stock table in response');
  
  // Simple regex-based parse since we don't have cheerio in scripts
  const stocks = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];
    const linkMatch = rowHtml.match(/href="\/stocks\/([A-Z0-9]+)\.html"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    
    const ticker = linkMatch[1];
    const nameRaw = linkMatch[2].replace(/<[^>]*>/g, '').trim().replace(/\s*(Ltd|Limited)\.?\s*$/i, '');
    
    // Extract cell values
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
    }
    
    if (cells.length < 6) continue;
    
    const close = parseFloat(cells[3]) || 0;
    const changeMatch = cells[4].match(/([+-]?[\d.]+)%/);
    const volMatch = cells[5].match(/([\d.]+)%/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    const volGainPct = volMatch ? parseFloat(volMatch[1]) : 0;
    
    if (close > 0 && ticker) {
      stocks.push({
        name: nameRaw,
        ticker,
        close,
        change,
        volGainPct,
        isPositive: change > 0,
      });
    }
  }
  
  console.log(`Parsed ${stocks.length} stocks from Chartink`);
  return stocks;
}

async function main() {
  const stocks = await scrapeChartink();
  
  if (stocks.length === 0) {
    console.error('No stocks scraped!');
    process.exit(1);
  }
  
  // Push to the backfill API
  const payload = JSON.stringify({ date: '2026-08-27', stocks });
  console.log(`Pushing ${stocks.length} stocks for 2026-08-27...`);
  
  const res = await fetch('https://stockh.vercel.app/api/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(30000),
  });
  
  const result = await res.json();
  console.log('Backfill result:', JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
