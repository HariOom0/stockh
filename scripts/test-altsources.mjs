// Test alternative data sources for Indian stock volume shockers

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testNSEBhavcopy() {
  console.log('=== Test: NSE Bhavcopy (daily bulk data) ===');
  try {
    // NSE provides bhavcopy zip at a predictable URL
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    
    // Try today's bhavcopy
    const url = `https://archives.nseindia.com/content/historical/EQUITIES/${yyyy}/${mm.toUpperCase()}/cm${dd}${mm.toUpperCase()}${yyyy}bhav.csv.zip`;
    console.log('URL:', url);
    
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    });
    console.log('Status:', resp.status);
    console.log('Location:', resp.headers.get('location'));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function testNSEIndices() {
  console.log('\n=== Test: NSE EOD data API ===');
  try {
    // NSE has a public API for EOD data
    const url = 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050';
    const resp = await fetch(url, {
      headers: { 
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    console.log('Status:', resp.status);
    if (resp.ok) {
      const data = await resp.json();
      console.log('Keys:', Object.keys(data));
      if (data.data) console.log('First item keys:', Object.keys(data.data[0] || {}));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function testMoneyControl() {
  console.log('\n=== Test: MoneyControl volume gainers ===');
  try {
    const url = 'https://priceapi.moneycontrol.com/techCharts/v1/history/a9e107f1eb2e4ff2b2e528d5e019ee70/1D/RELIANCE?d1=20260701&d2=20260722';
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    console.log('Status:', resp.status);
    if (resp.ok) {
      const text = await resp.text();
      console.log('Response length:', text.length);
      console.log('Preview:', text.slice(0, 200));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function testChartinkScreenerPage() {
  console.log('\n=== Test: Chartink screener page (with session) ===');
  try {
    // First visit the main screener page
    const pageResp = await fetch('https://chartink.com/screener', {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    console.log('Screener page status:', pageResp.status);
    const cookies = (pageResp.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    console.log('Cookies:', cookies.slice(0, 100));
    
    const html = await pageResp.text();
    const csrf = html.match(/csrf-token" content="([^"]+)"/)?.[1];
    console.log('CSRF:', !!csrf);
    
    if (csrf && cookies) {
      // Now try the API with full session
      const condition = '( ( 57369.11*(latest_volume/latest_avg_volume_30_cumulative ) ) >= 180 )';
      const apiResp = await fetch('https://chartink.com/screener/process', {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': csrf,
          Origin: 'https://chartink.com',
          Referer: 'https://chartink.com/screener',
          Cookie: cookies,
        },
        body: JSON.stringify({ scan_condition: condition }),
        signal: AbortSignal.timeout(30000),
      });
      const json = await apiResp.json();
      console.log('API result count:', (json.data || []).length);
      if (json.data?.length > 0) {
        console.log('First result:', JSON.stringify(json.data[0]).slice(0, 200));
      }
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

await testNSEBhavcopy();
await testNSEIndices();
await testMoneyControl();
await testChartinkScreenerPage();