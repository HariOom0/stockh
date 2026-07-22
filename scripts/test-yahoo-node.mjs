const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testSingle() {
  const url = 'https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d';
  console.log('Testing single ticker...');
  const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  console.log('Status:', resp.status);
  if (resp.ok) {
    const data = await resp.json();
    const r = data.chart.result[0];
    console.log('Symbol:', r.meta.symbol);
    const closes = r.indicators.quote[0].close.filter(c => c !== null);
    const volumes = r.indicators.quote[0].volume.filter(v => v !== null);
    console.log('Days:', closes.length);
    for (let i = 0; i < closes.length; i++) {
      console.log(`  Close=${closes[i]}, Vol=${volumes[i]}`);
    }
  } else {
    const text = await resp.text();
    console.log('Error:', text.slice(0, 300));
  }
}

async function testBatch() {
  // Try batch with different URL format
  const url = 'https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d';
  
  // Concurrent requests for 10 stocks
  const tickers = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'IRFC', 'RVNL', 'TATAPOWER'];
  
  console.log('\nTesting concurrent single requests for 10 stocks...');
  const start = Date.now();
  
  const results = await Promise.allSettled(
    tickers.map(async (t) => {
      const resp = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${t}.NS?range=5d&interval=1d`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      const r = data.chart.result[0];
      const closes = r.indicators.quote[0].close.filter(c => c !== null);
      const volumes = r.indicators.quote[0].volume.filter(v => v !== null);
      return { ticker: t, closes, volumes };
    })
  );
  
  const elapsed = Date.now() - start;
  console.log(`Completed in ${elapsed}ms`);
  
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { ticker, closes, volumes } = r.value;
      if (closes.length >= 2 && volumes.length >= 2) {
        const lc = closes[closes.length - 1];
        const pc = closes[closes.length - 2];
        const lv = volumes[volumes.length - 1];
        const pv = volumes[volumes.length - 2];
        const chg = ((lc / pc) - 1) * 100;
        const vg = ((lv / pv) - 1) * 100;
        console.log(`  ${ticker.padEnd(15)} Rs.${lc.toFixed(2)} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%  Vol:${vg >= 0 ? '+' : ''}${vg.toFixed(1)}%`);
      } else {
        console.log(`  ${ticker.padEnd(15)} Not enough data (${closes.length} days)`);
      }
    } else {
      console.log(`  FAILED: ${r.reason}`);
    }
  }
}

await testSingle();
await testBatch();