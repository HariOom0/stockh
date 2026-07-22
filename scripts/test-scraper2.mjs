const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
import * as cheerio from 'cheerio';

async function test() {
  // Test 1: Static EOD scanner page
  console.log('=== Test 1: Static EOD scanner page ===');
  try {
    const eodResp = await fetch('https://chartink.com/eodscanner/Volume-Shockers.html', {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    console.log('EOD status:', eodResp.status);
    const eodHtml = await eodResp.text();
    
    if (eodHtml.includes('Just a moment') || eodHtml.includes('cloudflare')) {
      console.log('BLOCKED by Cloudflare');
    } else if (eodHtml.includes('stocklisttable')) {
      console.log('Found stock table!');
      const $ = cheerio.load(eodHtml);
      const rows = $('table#stocklisttable tbody tr');
      console.log('Rows found:', rows.length);
      if (rows.length > 0) {
        const first = $(rows[0]).text().trim().slice(0, 100);
        console.log('First row:', first);
      }
    } else {
      console.log('No stock table. HTML length:', eodHtml.length);
      const titleMatch = eodHtml.match(/<title>(.*?)<\/title>/);
      console.log('Title:', titleMatch?.[1]);
    }
  } catch (e) {
    console.log('EOD test error:', e.message);
  }

  // Test 2: Chartink API with different condition
  console.log('\n=== Test 2: Chartink API (simpler condition) ===');
  try {
    const pageResp = await fetch('https://chartink.com/screener/process', {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const pageHtml = await pageResp.text();
    const csrf = pageHtml.match(/csrf-token" content="([^"]+)"/)?.[1];
    const cookies = (pageResp.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    console.log('CSRF:', !!csrf);

    // Try a known working condition - just volume > 1
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
      body: JSON.stringify({ scan_condition: '( latest_volume > 1000000 )' }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await apiResp.json();
    console.log('Simple query results:', (json.data || []).length);
    if (json.data && json.data.length > 0) {
      console.log('First:', JSON.stringify(json.data[0]).slice(0, 150));
    } else {
      console.log('Full resp:', JSON.stringify(json).slice(0, 300));
    }
  } catch (e) {
    console.log('API test error:', e.message);
  }
}

test().catch(e => console.error(e));